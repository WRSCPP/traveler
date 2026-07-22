// ----------------------------- Traveler configuration -----------------------------
// This single file decides where Traveler reads and writes its data. It is the
// only file you need to edit when moving between deployments.
//
//   'local'   — browser IndexedDB (the original desktop behaviour, no server)
//   'static'  — READ ONLY. Loads a JSON snapshot from DATA_URL. This is what
//               GitHub Pages serves: everyone can view, nobody can edit.
//   'cloud'   — Supabase (shared Postgres database, live updates, sign-in).
//
// Deployment notes:
//   * Read-only site  → set MODE to 'static'
//   * Full shared app → set MODE to 'cloud' and fill in SUPABASE below
//
// The Supabase values below are safe to publish. The anon key is a public
// client key; what actually protects the data is Row Level Security, which the
// included schema.sql turns on. Never put a service_role key in this file.

export const CONFIG = {
  MODE: 'static',

  // --- 'static' (read-only) settings ---
  // Path to the exported data snapshot, relative to index.html.
  DATA_URL: './data/traveler-data.json',

  // --- 'cloud' settings ---
  SUPABASE: {
    URL: '',      // e.g. 'https://abcdefgh.supabase.co'
    ANON_KEY: '', // the "anon public" key from Supabase → Settings → API
  },

  // Banner text shown at the top of the read-only site.
  READONLY_NOTE: 'Read-only view',
};

// True when the current mode cannot write.
export const IS_READONLY = CONFIG.MODE === 'static';
