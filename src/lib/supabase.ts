import {
  createClientComponentClient,
  createServerComponentClient,
} from '@supabase/auth-helpers-nextjs';

// Memoize the client on the global object so multiple calls from
// different components / renders return the same instance. This
// avoids creating multiple auth listeners or duplicate network
// requests caused by instantiating many clients in the browser.
export function createClient() {
  const g = globalThis as any;
  if (!g.__supabase_client) {
    g.__supabase_client = createClientComponentClient({
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    });
  }
  return g.__supabase_client;
}

export async function createServerClient() {
  const { cookies } = await import('next/headers');
  // Next 15 requires awaiting cookies() before usage in some contexts (route handlers)
  const cookieStore = await cookies();

  return createServerComponentClient(
    {
      // Provide an accessor that returns the already-fetched cookie store
      cookies: () => cookieStore,
    },
    {
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    }
  );
}
