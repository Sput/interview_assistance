import {
  createBrowserClient,
  createServerClient as createSupabaseServerClient
} from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Memoize the browser client so repeated renders do not create duplicate
// auth listeners or redundant network requests.
export function createClient() {
  const globalScope = globalThis as typeof globalThis & {
    __supabase_client?: ReturnType<typeof createBrowserClient>;
  };

  if (!globalScope.__supabase_client) {
    globalScope.__supabase_client = createBrowserClient(
      supabaseUrl,
      supabaseKey
    );
  }

  return globalScope.__supabase_client;
}

export async function createServerClient() {
  const { cookies } = await import('next/headers');
  const cookieStore = await cookies();

  return createSupabaseServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot write cookies. Middleware refreshes the
          // session cookies before protected pages render.
        }
      }
    }
  });
}
