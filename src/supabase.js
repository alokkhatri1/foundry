import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey || url.includes('your-project-ref')) {
  console.warn(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set. ' +
    'Shared state is disabled until you paste them into .env.'
  );
}

export const supabase = createClient(url || 'http://placeholder', anonKey || 'placeholder', {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
  realtime: { params: { eventsPerSecond: 10 } },
});

export const isSupabaseConfigured = !!(url && anonKey && !url.includes('your-project-ref'));
console.log('[supabase] configured:', isSupabaseConfigured, 'url:', url?.slice(0, 30));
