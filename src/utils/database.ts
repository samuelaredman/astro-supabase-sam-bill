import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';
import type { Database } from '../../supabase/types';

let adminClient: SupabaseClient<Database> | null = null;

/**
 * Admin client — uses the service role key to bypass RLS.
 * Only call this from server-side API routes, never expose to the client.
 *
 * Memoized at module scope: the service-role key never rotates per request,
 * and @supabase/supabase-js clients are stateless under `persistSession: false`.
 * Reusing the client avoids per-call fetch/auth setup across ~36 call sites.
 */
export function getSupabaseAdmin() {
  if (adminClient) return adminClient;
  const supabaseUrl = import.meta.env.SUPABASE_DATABASE_URL;
  const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_DATABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
  }
  adminClient = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  return adminClient;
}

export function getSupabase() {
  const supabaseUrl = import.meta.env.SUPABASE_DATABASE_URL;
  const supabaseKey = import.meta.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase env vars');
  return createClient<Database>(supabaseUrl, supabaseKey);
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

export function createSupabaseServerClientFromContext(context: { request: Request; cookies: any }) {
  return createServerClient(
    import.meta.env.SUPABASE_DATABASE_URL,
    import.meta.env.SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return parseCookieHeader(context.request.headers.get('Cookie') ?? '')
            .filter((cookie): cookie is { name: string; value: string } =>
              cookie.value !== undefined
            );
        },
        setAll(cookiesToSet: { name: string; value: string; options: Record<string, any> }[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
            context.cookies.set(name, value, options);
          });
        },
      },
    }
  );
}
