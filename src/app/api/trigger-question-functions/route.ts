import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  try {
    const { question_id } = await req.json();
    
    if (!question_id) {
      return NextResponse.json(
        { error: 'question_id is required' },
        { status: 400 }
      );
    }

    console.log('🚀 Triggering edge functions for question_id:', question_id);

    // Create Supabase client; prefer service role if available (server-only)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // Prepare Authorization header for invoking protected Edge Functions
    let authHeader: Record<string, string> = {};
    try {
      const { cookies } = await import('next/headers');
      const cookieStore = await cookies();
      const accessToken = cookieStore.get('sb-access-token')?.value;
      if (accessToken) {
        authHeader = { Authorization: `Bearer ${accessToken}` };
      } else if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
        authHeader = { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` };
      } else if (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
        authHeader = { Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` };
      }
    } catch (_) {}

    const results = {
      populate_model_answer: null,
      make_vectors: null,
      errors: [] as string[],
      debug: {
        populate_model_answer: null as
          | null
          | {
              status?: number;
              statusText?: string;
              requestId?: string | null;
              denoId?: string | null;
              responseBody?: any;
              responseText?: string | null;
            },
        make_vectors: null as
          | null
          | {
              status?: number;
              statusText?: string;
              requestId?: string | null;
              denoId?: string | null;
              responseBody?: any;
              responseText?: string | null;
            }
      }
    };

    // Call populate_model_answer
    console.log('📞 Calling populate_model_answer with question_id:', question_id);
    try {
      const startTime = Date.now();
      const { data: popData, error: popError } = await supabase.functions.invoke(
        'populate_model_answer',
        { headers: authHeader, body: { question_id } }
      );
      const elapsed = Date.now() - startTime;
      console.log(`⏱️ populate_model_answer took ${elapsed}ms`);
      
      if (popError) {
        let responseBody: any = null;
        let responseText: string | null = null;
        let status: number | undefined;
        let statusText: string | undefined;
        let requestId: string | null = null;
        let denoId: string | null = null;
        try {
          const resp = popError.context as Response | undefined;
          if (resp) {
            status = resp.status;
            statusText = resp.statusText;
            requestId = resp.headers.get('sb-request-id');
            denoId = resp.headers.get('x-deno-execution-id');
            try {
              responseBody = await resp.clone().json();
            } catch (_) {
              try {
                responseText = await resp.clone().text();
              } catch (_) {}
            }
          }
        } catch (_) {}

        const debugObj = {
          message: popError.message,
          status,
          statusText,
          requestId,
          denoId,
          responseBody,
          responseText,
        };
        console.error('❌ populate_model_answer error:', debugObj);
        results.debug.populate_model_answer = debugObj;
        results.errors.push(`populate_model_answer: ${popError.message || JSON.stringify(popError)}`);
      } else {
        console.log('✅ populate_model_answer success:', popData);
        results.populate_model_answer = popData;
      }
    } catch (err: any) {
      console.error('❌ populate_model_answer exception:', {
        message: err.message,
        stack: err.stack,
        full: err
      });
      results.errors.push(`populate_model_answer: ${err.message || String(err)}`);
    }

    // Call make_vectors
    console.log('📞 Calling make_vectors with question_id:', question_id);
    try {
      const startTime = Date.now();
      const { data: vecData, error: vecError } = await supabase.functions.invoke(
        'make_vectors',
        { headers: authHeader, body: { question_id } }
      );
      const elapsed = Date.now() - startTime;
      console.log(`⏱️ make_vectors took ${elapsed}ms`);
      
      if (vecError) {
        let responseBody: any = null;
        let responseText: string | null = null;
        let status: number | undefined;
        let statusText: string | undefined;
        let requestId: string | null = null;
        let denoId: string | null = null;
        try {
          const resp = vecError.context as Response | undefined;
          if (resp) {
            status = resp.status;
            statusText = resp.statusText;
            requestId = resp.headers.get('sb-request-id');
            denoId = resp.headers.get('x-deno-execution-id');
            try {
              responseBody = await resp.clone().json();
            } catch (_) {
              try {
                responseText = await resp.clone().text();
              } catch (_) {}
            }
          }
        } catch (_) {}

        const debugObj = {
          message: vecError.message,
          status,
          statusText,
          requestId,
          denoId,
          responseBody,
          responseText,
        };
        console.error('❌ make_vectors error:', debugObj);
        results.debug.make_vectors = debugObj;
        results.errors.push(`make_vectors: ${vecError.message || JSON.stringify(vecError)}`);
      } else {
        console.log('✅ make_vectors success:', vecData);
        results.make_vectors = vecData;
      }
    } catch (err: any) {
      console.error('❌ make_vectors exception:', {
        message: err.message,
        stack: err.stack,
        full: err
      });
      results.errors.push(`make_vectors: ${err.message || String(err)}`);
    }

    console.log('✅ Edge functions completed');
    return NextResponse.json(results);

  } catch (err: any) {
    console.error('❌ API route error:', err);
    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}
