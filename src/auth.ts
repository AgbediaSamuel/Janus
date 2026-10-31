import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const auth = url && key ? createClient(url, key) : null;

export async function authorizationHeaders(): Promise<Record<string, string>> {
  if (!auth) return {};
  const { data } = await auth.auth.getSession();
  return data.session
    ? { Authorization: `Bearer ${data.session.access_token}` }
    : {};
}
