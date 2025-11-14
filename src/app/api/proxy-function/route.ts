import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type InvokeBody = {
  name: string;
  payload?: any;
};

export async function POST(req: NextRequest) {
  try {
    const { name, payload }: InvokeBody = await req.json();

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Missing function name' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !anon) {
      return NextResponse.json(
        { error: 'Supabase env not configured' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, service || anon);

    // Build Authorization header: prefer user JWT from cookie; else service; else anon
    let headers: Record<string, string> = {};
    try {
      const { cookies } = await import('next/headers');
      const cookieStore = await cookies();
      const accessToken = cookieStore.get('sb-access-token')?.value;
      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      } else if (service) {
        headers.Authorization = `Bearer ${service}`;
      } else if (anon) {
        headers.Authorization = `Bearer ${anon}`;
      }
    } catch {}

    const { data, error } = await supabase.functions.invoke(name, {
      headers,
      body: payload ?? {},
    });

    if (error) {
      // Try to unwrap context details for easier debugging
      let status: number | undefined;
      let statusText: string | undefined;
      let contextBody: any = undefined;
      try {
        const resp = (error as any)?.context as Response | undefined;
        if (resp) {
          status = resp.status;
          statusText = resp.statusText;
          try {
            contextBody = await resp.clone().json();
          } catch {
            try { contextBody = await resp.clone().text(); } catch {}
          }
        }
      } catch {}

      return NextResponse.json(
        {
          error: error.message || 'Function invoke failed',
          status,
          statusText,
          context: contextBody,
        },
        { status: status ?? 500 }
      );
    }

    return NextResponse.json({ ok: true, data });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
  }
}

