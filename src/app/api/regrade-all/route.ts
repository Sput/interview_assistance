import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type AnswerRow = {
  id: number;
  question_id: number | null;
  answer_text: string | null;
  embedding?: unknown;
  questions_table?: { embedding?: unknown } | null;
  grade?: number | null;
};

function parseVector(v: unknown): number[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((x) => Number(x));
  if (typeof v === 'object') {
    for (const k of ['data', 'vector', 'embedding', 'value']) {
      if (k in (v as any)) return parseVector((v as any)[k]);
    }
    return [];
  }
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch {}
    const s = v.trim();
    if (s.startsWith('(') && s.endsWith(')')) {
      return s.slice(1, -1).split(',').filter(Boolean).map(Number);
    }
  }
  return [];
}

function cosineSimilarity(a: number[], b: number[]): number | null {
  if (!a.length || !b.length || a.length !== b.length) return null;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] || 0;
    const bi = b[i] || 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) return null;
  return dot / Math.sqrt(na * nb);
}

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const secret = process.env.REGRADE_SECRET;

  if (!url || !anon) {
    return NextResponse.json({ error: 'Supabase env missing' }, { status: 500 });
  }

  // Require a secret header to prevent public abuse
  if (secret) {
    const provided = req.headers.get('x-regrade-secret');
    if (provided !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const { searchParams } = new URL(req.url);
  const includeAll = searchParams.get('all') === 'true';
  const limit = Math.max(1, Math.min(1000, Number(searchParams.get('limit') || 500)));

  const supabase = createClient(url, service || anon);

  const summary = {
    includeAll,
    batches: 0,
    scanned: 0,
    updated: 0,
    skippedMissingEmbeddings: 0,
    errors: [] as Array<{ id?: number; message: string }>,
  };

  try {
    // Paged scan to avoid timeouts
    for (let page = 0; page < 1000; page++) {
      summary.batches++;
      const from = page * limit;
      const to = from + limit - 1;

      let query = supabase
        .from('answers_table')
        .select('id,question_id,answer_text,embedding,grade,questions_table(embedding)')
        .neq('answer_text', null)
        .order('id', { ascending: true })
        .range(from, to);

      if (!includeAll) {
        query = query.is('grade', null);
      }

      const { data: rows, error } = await query;
      if (error) {
        summary.errors.push({ message: `fetch page ${page}: ${error.message}` });
        break;
      }
      if (!rows || rows.length === 0) break;

      for (const row of rows as AnswerRow[]) {
        summary.scanned++;
        try {
          const aVec = parseVector(row.embedding);
          const qVec = parseVector(row.questions_table?.embedding);
          if (!aVec.length || !qVec.length) {
            summary.skippedMissingEmbeddings++;
            continue;
          }
          const sim = cosineSimilarity(aVec, qVec);
          if (sim == null || !isFinite(sim)) continue;
          const grade = Math.round(sim * 100);
          const { error: upErr } = await supabase
            .from('answers_table')
            .update({ grade })
            .eq('id', row.id);
          if (upErr) {
            summary.errors.push({ id: row.id, message: upErr.message });
          } else {
            summary.updated++;
          }
        } catch (e: any) {
          summary.errors.push({ id: row.id, message: e?.message || String(e) });
        }
      }
    }

    return NextResponse.json({ ok: true, summary });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'regrade failed', summary }, { status: 500 });
  }
}

