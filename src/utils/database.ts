import { createClient } from '@supabase/supabase-js';
import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';

export function getSupabase() {
  const supabaseUrl = import.meta.env.SUPABASE_DATABASE_URL;
  const supabaseKey = import.meta.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase env vars');
  return createClient(supabaseUrl, supabaseKey);
}

export function createSupabaseServerClient(request: Request, response: Response) {
  return createServerClient(
    import.meta.env.SUPABASE_DATABASE_URL,
    import.meta.env.SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return parseCookieHeader(request.headers.get('Cookie') ?? '')
            .filter((cookie): cookie is { name: string; value: string } =>
              cookie.value !== undefined
            );
        },
        setAll(cookiesToSet: { name: string; value: string; options: Record<string, any> }[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.headers.append(
              'Set-Cookie',
              serializeCookieHeader(name, value, options)
            );
          });
        },
      },
    }
  );
}
