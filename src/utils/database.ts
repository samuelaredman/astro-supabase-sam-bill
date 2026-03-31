import { createClient } from '@supabase/supabase-js';
import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';
import type { Database } from '../../supabase/types';

const supabaseUrl = import.meta.env.SUPABASE_DATABASE_URL;
const supabaseKey = import.meta.env.SUPABASE_ANON_KEY;

export const supabase = supabaseUrl && supabaseKey
  ? createClient<Database>(supabaseUrl, supabaseKey)
  : null;

export function createSupabaseServerClient(request: Request, response: Response) {
  const url = import.meta.env.SUPABASE_DATABASE_URL;
  const key = import.meta.env.SUPABASE_ANON_KEY;
  
  if (!url || !key) throw new Error('Missing Supabase environment variables');

  return createServerClient(url, key, {
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
  });
}
