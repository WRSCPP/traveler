// ----------------------------- Static (read-only) backend -----------------------------
// Serves a published JSON snapshot through the exact same six-method contract the
// IndexedDB backend implements, so the Repository and the whole app are unchanged.
// Every write is a no-op: this backend is used for the public read-only site.

const STORES = ['builds', 'lines', 'stages', 'settings', 'audit'];

function cloneSafe(v) {
  return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));
}

// Accepts either a Traveler backup file ({ builds, lines, stages, settings, audit })
// or a bare object of the same shape, and normalises it into per-store Maps.
function toMaps(payload) {
  const data = Object.fromEntries(STORES.map((s) => [s, new Map()]));
  if (!payload || typeof payload !== 'object') return data;
  const src = payload.data && typeof payload.data === 'object' ? payload.data : payload;

  for (const store of STORES) {
    const rows = src[store];
    if (!rows) continue;
    if (Array.isArray(rows)) {
      for (const row of rows) if (row && row.id != null) data[store].set(row.id, row);
    } else if (store === 'settings' && typeof rows === 'object') {
      // Settings may be exported as a single object rather than a list.
      const rec = { ...rows, id: 'app' };
      data[store].set('app', rec);
    }
  }
  return data;
}

export function createStaticBackend(dataUrl) {
  let ready = null;
  let data = Object.fromEntries(STORES.map((s) => [s, new Map()]));

  function load() {
    if (ready) return ready;
    ready = fetch(dataUrl, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load data (${r.status})`);
        return r.json();
      })
      .then((json) => { data = toMaps(json); })
      .catch((err) => {
        // Leave the maps empty; the app shows its normal empty states and we
        // surface a clear message rather than failing silently.
        console.error('Traveler: failed to load published data —', err);
        throw err;
      });
    return ready;
  }

  const noop = async () => { /* read-only: writes are intentionally ignored */ };

  return {
    async get(store, key) { await load(); return data[store].get(key) ?? null; },
    async getAll(store) { await load(); return [...data[store].values()].map(cloneSafe); },
    put: noop,
    delete: noop,
    clear: noop,
    bulkPut: noop,
    isMemory: false,
    isReadOnly: true,
    // Lets the app surface a load failure to the user.
    whenLoaded: () => load(),
  };
}
