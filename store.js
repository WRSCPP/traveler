/**
 * Traveler persistence layer
 * ------------------------------------------------------------------
 * Durable local storage for all planning data using IndexedDB, with an
 * in-memory fallback (so the same API works in Node tests and in browsers
 * where IndexedDB is unavailable).
 *
 * Why IndexedDB instead of the prototype's in-memory arrays:
 *   - Data survives page refreshes and browser restarts.
 *   - It's transactional, so a half-finished write can't corrupt state.
 *   - It scales to thousands of records without slowing the UI.
 *   - It gives a clean migration path: the same object shapes and the same
 *     repository API can later point at a real server database with no change
 *     to the calling code.
 *
 * Everything is namespaced under a schema version so future changes can run
 * migrations rather than silently breaking older saved data.
 */

const DB_NAME = 'traveler';
const DB_VERSION = 1;
const STORES = ['builds', 'lines', 'stages', 'settings', 'audit'];

// Compare two build states and return a list of meaningful, human-readable
// changes for the history trail. Focuses on the events that matter operationally:
// status transitions, stage progress (start / completion), and the key dates.
function diffBuild(prev, next) {
  const changes = [];
  const label = (s) => (s == null || s === '' ? '—' : String(s));

  if (prev.status !== next.status) {
    changes.push({ kind: 'status', field: 'status', from: prev.status, to: next.status, label: `Status: ${label(prev.status)} → ${label(next.status)}` });
  }
  const dateFields = [
    ['confirmedStart', 'Start date'],
    ['tentativeStart', 'Tentative start'],
    ['targetShip', 'Target ship'],
    ['actualShip', 'Shipped'],
  ];
  for (const [field, name] of dateFields) {
    if ((prev[field] || null) !== (next[field] || null)) {
      changes.push({ kind: field === 'actualShip' ? 'shipped' : 'date', field, from: prev[field] || null, to: next[field] || null, label: `${name}: ${label(prev[field])} → ${label(next[field])}` });
    }
  }
  // Per-stage progress transitions (e.g. a stage started or was completed).
  const pPrev = prev.stageProgress || {};
  const pNext = next.stageProgress || {};
  const stageIds = new Set([...Object.keys(pPrev), ...Object.keys(pNext)]);
  for (const sid of stageIds) {
    const a = Math.round((pPrev[sid] || 0) * 100);
    const b = Math.round((pNext[sid] || 0) * 100);
    if (a === b) continue;
    let kind = 'stage-progress';
    if (b >= 100 && a < 100) kind = 'stage-complete';
    else if (a === 0 && b > 0) kind = 'stage-start';
    changes.push({ kind, field: `stage:${sid}`, stageId: sid, from: a, to: b, label: `Stage ${sid}: ${a}% → ${b}%` });
  }
  return changes;
}

// ----------------------------- In-memory fallback -----------------------------
// Mirrors the tiny slice of the IndexedDB API this module relies on, so unit
// tests and non-browser contexts exercise the exact same repository code paths.

function createMemoryBackend() {
  const data = Object.fromEntries(STORES.map((s) => [s, new Map()]));
  return {
    async get(store, key) { return data[store].get(key) ?? null; },
    async getAll(store) { return [...data[store].values()]; },
    async put(store, value) { data[store].set(value.id, structuredCloneSafe(value)); return value; },
    async delete(store, key) { data[store].delete(key); },
    async clear(store) { data[store].clear(); },
    async bulkPut(store, values) { for (const v of values) data[store].set(v.id, structuredCloneSafe(v)); },
    isMemory: true,
  };
}

function structuredCloneSafe(v) {
  return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));
}

// ----------------------------- IndexedDB backend -----------------------------

function createIdbBackend() {
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const store of STORES) {
          if (!db.objectStoreNames.contains(store)) {
            db.createObjectStore(store, { keyPath: 'id' });
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(store, mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const os = t.objectStore(store);
      let result;
      Promise.resolve(fn(os)).then((r) => { result = r; });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }

  const reqToPromise = (req) => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return {
    async get(store, key) { return tx(store, 'readonly', (os) => reqToPromise(os.get(key)).then((r) => r ?? null)); },
    async getAll(store) { return tx(store, 'readonly', (os) => reqToPromise(os.getAll())); },
    async put(store, value) { await tx(store, 'readwrite', (os) => reqToPromise(os.put(value))); return value; },
    async delete(store, key) { return tx(store, 'readwrite', (os) => reqToPromise(os.delete(key))); },
    async clear(store) { return tx(store, 'readwrite', (os) => reqToPromise(os.clear())); },
    async bulkPut(store, values) { return tx(store, 'readwrite', (os) => { for (const v of values) os.put(v); }); },
    isMemory: false,
  };
}

// ----------------------------- Backend selection -----------------------------

export function createBackend() {
  // Deployment mode decides where data lives. 'local' keeps the original
  // IndexedDB behaviour; the other modes are injected by main.js so this module
  // stays free of network dependencies for unit tests.
  if (globalThis.__TRAVELER_BACKEND__) return globalThis.__TRAVELER_BACKEND__;
  const hasIdb = typeof indexedDB !== 'undefined';
  return hasIdb ? createIdbBackend() : createMemoryBackend();
}

// ----------------------------- Repository -----------------------------
// A typed, intention-revealing API over the backend. This is what the app calls;
// it never touches the raw store. Swapping IndexedDB for a server API later means
// re-implementing only this class.

export class Repository extends EventTarget {
  constructor(backend = createBackend()) {
    super();
    this.backend = backend;
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  // --- Builds ---
  async listBuilds() { return this.backend.getAll('builds'); }
  async getBuild(id) { if (!id) return null; return this.backend.get('builds', id); }
  async saveBuild(build, actor = 'system') {
    const prev = await this.backend.get('builds', build.id);
    const now = new Date().toISOString();
    const record = { ...build, updatedAt: now, createdAt: (prev && prev.createdAt) || build.createdAt || now };
    await this.backend.put('builds', record);
    // Capture *what* changed so history can be reconstructed with timestamps —
    // especially status transitions, stage progress, and ship/completion dates.
    const changes = prev ? diffBuild(prev, record) : null;
    await this.recordAudit({
      entity: 'build', entityId: build.id, entityName: build.name || prev?.name || '',
      action: prev ? 'update' : 'create', actor, at: now,
      changes,
    });
    this.emit('builds:changed', { id: build.id, action: prev ? 'update' : 'create' });
    return record;
  }
  async deleteBuild(id, actor = 'system') {
    const prev = await this.backend.get('builds', id);
    await this.backend.delete('builds', id);
    await this.recordAudit({ entity: 'build', entityId: id, entityName: prev?.name || '', action: 'delete', actor, at: new Date().toISOString() });
    this.emit('builds:changed', { id, action: 'delete' });
  }

  // --- Lines ---
  async listLines() { return this.backend.getAll('lines'); }
  async saveLine(line) { await this.backend.put('lines', line); this.emit('lines:changed', { id: line.id }); return line; }
  async deleteLine(id) { await this.backend.delete('lines', id); this.emit('lines:changed', { id }); }

  // --- Stages ---
  async listStages() { return (await this.backend.getAll('stages')).sort((a, b) => a.order - b.order); }
  async saveStage(stage) { await this.backend.put('stages', stage); this.emit('stages:changed', { id: stage.id }); return stage; }
  async deleteStage(id) { await this.backend.delete('stages', id); this.emit('stages:changed', { id }); }

  // --- Settings (single doc keyed 'app') ---
  async getSettings() { return (await this.backend.get('settings', 'app')) || { id: 'app' }; }
  async saveSettings(settings) { const rec = { ...settings, id: 'app' }; await this.backend.put('settings', rec); this.emit('settings:changed', {}); return rec; }

  // --- Audit trail ---
  async recordAudit(entry) {
    const rec = { id: `${entry.at}-${Math.random().toString(36).slice(2, 8)}`, ...entry };
    await this.backend.put('audit', rec);
    return rec;
  }
  async listAudit() { return (await this.backend.getAll('audit')).sort((a, b) => (a.at < b.at ? 1 : -1)); }

  // Chronological event timeline for a single build, oldest first, decorated with
  // human-readable event descriptions (created, status changes, stage completions,
  // shipping/completion dates).
  async buildHistory(buildId) {
    const all = await this.backend.getAll('audit');
    return all
      .filter((r) => r.entity === 'build' && r.entityId === buildId)
      .sort((a, b) => (a.at < b.at ? -1 : 1));
  }

  // A flattened event stream across all builds for the history report — each
  // significant change becomes its own timestamped row.
  async historyEvents() {
    const all = await this.backend.getAll('audit');
    const events = [];
    for (const rec of all) {
      if (rec.entity !== 'build') continue;
      if (rec.action === 'create') {
        events.push({ at: rec.at, buildId: rec.entityId, name: rec.entityName, kind: 'created', label: 'Build created' });
      } else if (rec.action === 'delete') {
        events.push({ at: rec.at, buildId: rec.entityId, name: rec.entityName, kind: 'deleted', label: 'Build deleted' });
      } else if (rec.changes && rec.changes.length) {
        for (const c of rec.changes) {
          events.push({ at: rec.at, buildId: rec.entityId, name: rec.entityName, kind: c.kind, label: c.label, field: c.field, stageId: c.stageId, from: c.from, to: c.to });
        }
      }
    }
    return events.sort((a, b) => (a.at < b.at ? 1 : -1));
  }

  // --- Bulk / lifecycle ---
  async seed({ builds = [], lines = [], stages = [], settings = null }) {
    if (lines.length) await this.backend.bulkPut('lines', lines);
    if (stages.length) await this.backend.bulkPut('stages', stages);
    if (builds.length) await this.backend.bulkPut('builds', builds);
    if (settings) await this.saveSettings(settings);
    this.emit('seeded', {});
  }
  async isEmpty() { return (await this.listBuilds()).length === 0 && (await this.listLines()).length === 0; }
  async exportAll() {
    return {
      version: DB_VERSION,
      exportedAt: new Date().toISOString(),
      builds: await this.listBuilds(),
      lines: await this.listLines(),
      stages: await this.listStages(),
      settings: await this.getSettings(),
    };
  }
  async importAll(payload) {
    for (const store of ['builds', 'lines', 'stages']) await this.backend.clear(store);
    await this.seed(payload);
  }
}
