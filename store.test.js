/**
 * Persistence layer tests. Uses the in-memory backend (no IndexedDB in Node).
 * Run with: node src/store.test.js
 */
import { Repository, createBackend } from './store.js';

let passed = 0, failed = 0;
const fails = [];
function ok(cond, msg) { if (cond) passed++; else { failed++; fails.push('✗ ' + msg); } }
function eq(a, e, msg) { ok(JSON.stringify(a) === JSON.stringify(e), `${msg} (expected ${JSON.stringify(e)}, got ${JSON.stringify(a)})`); }

async function run() {
  const repo = new Repository(createBackend());
  ok(repo.backend.isMemory, 'uses in-memory backend under Node');

  // Empty to start.
  ok(await repo.isEmpty(), 'repo starts empty');

  // Create + read back.
  await repo.saveBuild({ id: 'b1', name: 'Ofland Mod A', lineId: 'A', status: 'pipeline' }, 'alice');
  const b = await repo.getBuild('b1');
  eq(b.name, 'Ofland Mod A', 'build persisted and read back');
  ok(b.createdAt && b.updatedAt, 'timestamps stamped on save');

  // Update keeps createdAt, bumps updatedAt.
  const created = b.createdAt;
  await new Promise((r) => setTimeout(r, 5));
  await repo.saveBuild({ ...b, status: 'active' }, 'alice');
  const b2 = await repo.getBuild('b1');
  eq(b2.status, 'active', 'update applied');
  eq(b2.createdAt, created, 'createdAt preserved across update');
  ok(b2.updatedAt >= created, 'updatedAt advanced');

  // Audit trail recorded create + update.
  const audit = await repo.listAudit();
  ok(audit.length >= 2, 'audit entries recorded for create and update');
  ok(audit.some((a) => a.action === 'create' && a.actor === 'alice'), 'audit captured create with actor');
  ok(audit.some((a) => a.action === 'update'), 'audit captured update');

  // Field-level change capture: the status change pipeline→active is recorded.
  const updateWithChanges = audit.find((a) => a.action === 'update' && a.changes && a.changes.some((c) => c.kind === 'status'));
  ok(updateWithChanges, 'status change captured in audit changes');

  // Stage completion is captured as a distinct event.
  await repo.saveBuild({ id: 'b1', name: 'Ofland Mod A', lineId: 'A', status: 'active', stageProgress: { framing: 1 } }, 'alice');
  const hist = await repo.buildHistory('b1');
  ok(hist.length >= 2, 'buildHistory returns chronological entries for a build');
  const events = await repo.historyEvents();
  ok(events.some((e) => e.kind === 'stage-complete' && e.buildId === 'b1'), 'stage completion surfaced as a history event');
  ok(events.some((e) => e.kind === 'created'), 'creation surfaced as a history event');

  // Events fire on change.
  let eventFired = false;
  repo.addEventListener('builds:changed', () => { eventFired = true; });
  await repo.saveBuild({ ...b2, name: 'Renamed' });
  ok(eventFired, 'builds:changed event fired on save');

  // Delete removes + audits.
  await repo.deleteBuild('b1', 'bob');
  ok((await repo.getBuild('b1')) === null, 'build deleted');
  ok((await repo.listAudit()).some((a) => a.action === 'delete' && a.actor === 'bob'), 'delete audited');

  // Lines + stages.
  await repo.saveLine({ id: 'A', name: 'Line A', capacity: 2 });
  await repo.saveStage({ id: 'frame', label: 'Framing', order: 2 });
  await repo.saveStage({ id: 'pipeline', label: 'Pipeline', order: 1 });
  const stages = await repo.listStages();
  eq(stages.map((s) => s.id), ['pipeline', 'frame'], 'stages returned in order');

  // Settings round-trip.
  await repo.saveSettings({ moduleTypes: ['Pisqah', 'Cascade'] });
  eq((await repo.getSettings()).moduleTypes, ['Pisqah', 'Cascade'], 'settings persisted');

  // Export / import round-trip.
  await repo.saveBuild({ id: 'b9', name: 'Keep me', lineId: 'A', status: 'active' });
  const dump = await repo.exportAll();
  const repo2 = new Repository(createBackend());
  await repo2.importAll(dump);
  eq((await repo2.getBuild('b9')).name, 'Keep me', 'import restores builds');
  eq((await repo2.listLines()).length, 1, 'import restores lines');
  eq((await repo2.getSettings()).moduleTypes, ['Pisqah', 'Cascade'], 'import restores settings');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (fails.length) { console.log('\n' + fails.join('\n')); process.exit(1); }
  else console.log('All store tests passed ✓');
}

run();
