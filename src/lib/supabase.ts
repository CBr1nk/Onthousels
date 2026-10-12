import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isConfigured = Boolean(url && key)

// When env vars are missing the app renders a setup screen and never touches this client.
export const supabase: SupabaseClient = isConfigured
  ? createClient(url!, key!, { auth: { flowType: 'pkce' } })
  : (null as unknown as SupabaseClient)
