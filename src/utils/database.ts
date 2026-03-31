import { createClient } from '@supabase/supabase-js'
import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';
import type { Database } from '../../supabase/types'
import type { CookieOptions } from '@supabase/ssr';


const supabaseUrl = import.meta.env.SUPABASE_DATABASE_URL
const supabaseKey = import.meta.env.SUPABASE_ANON_KEY

export const supabase = supabaseUrl && supabaseKey
  ? createClient<Database>(supabaseUrl, supabaseKey)
  : null;

export function createSupabaseServerClient(request: Request, response: Response) {
  return createServerClient(
    import.meta.env.SUPABASE_DATABASE_URL,
    import.meta.env.SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return parseCookieHeader(request.headers.get('Cookie') ?? '');
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
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
