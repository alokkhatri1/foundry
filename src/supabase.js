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
  realtime: { params: { eventsPerSecond: 10 } },
});

export const isSupabaseConfigured = !!(url && anonKey && !url.includes('your-project-ref'));
