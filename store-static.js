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

  // Try the configured location first, then the most common places the file
  // ends up when a folder doesn't survive an upload. This makes publishing
  // forgiving rather than all-or-nothing.
  const candidates = [...new Set([
    dataUrl,
    './data/traveler-data.json',
    './traveler-data.json',
    './data/traveler-data.JSON',
  ].filter(Boolean))];

  async function fetchFirst() {
    const tried = [];
    for (const url of candidates) {
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) { tried.push(`${url} (${r.status})`); continue; }
        // A missing file on some hosts returns the HTML 404 page with a 200.
        const text = await r.text();
        if (/^\s*</.test(text)) { tried.push(`${url} (not JSON)`); continue; }
        return { json: JSON.parse(text), url };
      } catch (e) {
        tried.push(`${url} (${e.message})`);
      }
    }
    const err = new Error('No data file found');
    err.tried = tried;
    throw err;
  }

  function load() {
    if (ready) return ready;
    ready = fetchFirst()
      .then(({ json, url }) => {
        data = toMaps(json);
        const total = STORES.reduce((n, s) => n + data[s].size, 0);
        console.info(`Traveler: loaded ${total} records from ${url}`);
      })
      .catch((err) => {
        console.error('Traveler: failed to load published data —', err.tried || err);
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
