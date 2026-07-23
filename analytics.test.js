/**
 * Analytics engine test suite. Run: node src/analytics.test.js
 * Zero-dependency assert harness.
 */
import {
  completedBuilds, onTimeDelivery, cycleTime, estimateAccuracy,
  bottleneckAnalysis, lineUtilization, throughput, backlog, buildReport,
} from './analytics.js';

let passed = 0, failed = 0; const fails = [];
function ok(c, m) { if (c) passed++; else { failed++; fails.push('✗ ' + m); } }
function eq(a, e, m) { ok(JSON.stringify(a) === JSON.stringify(e), `${m} — expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); }
function near(a, e, m, tol = 0.5) { ok(Math.abs(a - e) <= tol, `${m} — expected ~${e}, got ${a}`); }

const stages = [
  { id: 'frame', label: 'Framing', order: 1 },
  { id: 'mep', label: 'MEP', order: 2 },
  { id: 'finish', label: 'Finish', order: 3 },
];
const lines = [
  { id: 'A', name: 'Line A', capacity: 2, workdaysPerWeek: 5 },
  { id: 'B', name: 'Line B', capacity: 1, workdaysPerWeek: 5 },
];

function mk(over = {}) {
  return {
    id: 'b', name: 'B', client: 'C', moduleType: 'Pisqah', lineId: 'A',
    status: 'complete', confirmedStart: null, tentativeStart: null,
    targetShip: null, actualStart: null, actualShip: null,
    stageDurations: { frame: 5, mep: 5, finish: 5 }, stageProgress: {},
    stageActuals: {}, priority: 100, ...over,
  };
}

// ----- completedBuilds -----
eq(completedBuilds([mk({ id: '1', actualShip: '2026-03-01' }), mk({ id: '2', status: 'active' })]).length, 1, 'completedBuilds needs status+actualShip');

// ----- onTimeDelivery -----
{
  const bs = [
    mk({ id: '1', targetShip: '2026-03-10', actualShip: '2026-03-08' }), // on time
    mk({ id: '2', targetShip: '2026-03-10', actualShip: '2026-03-10' }), // on time (equal)
    mk({ id: '3', targetShip: '2026-03-10', actualShip: '2026-03-17' }), // late by 5 wd
  ];
  const r = onTimeDelivery(bs);
  eq(r.onTime, 2, 'on-time count');
  eq(r.late, 1, 'late count');
  near(r.rate, 66.7, 'on-time rate');
  near(r.avgLatenessDays, 5, 'avg lateness in working days'); // Mar 11..17 = 5 workdays
}
eq(onTimeDelivery([mk({ id: 'x', actualShip: '2026-03-01' })]).rate, null, 'no-target completed excluded → null rate');

// ----- cycleTime -----
{
  const bs = [
    mk({ id: '1', moduleType: 'Pisqah', actualStart: '2026-02-02', actualShip: '2026-02-06' }), // 5 wd
    mk({ id: '2', moduleType: 'Pisqah', actualStart: '2026-02-02', actualShip: '2026-02-13' }), // 10 wd
    mk({ id: '3', moduleType: 'Cascade', actualStart: '2026-02-02', actualShip: '2026-02-20' }), // 15 wd
  ];
  const r = cycleTime(bs);
  eq(r.count, 3, 'cycle count');
  near(r.meanDays, 10, 'mean cycle days');
  const pisqah = r.perType.find((t) => t.type === 'Pisqah');
  near(pisqah.meanDays, 7.5, 'per-type mean for Pisqah');
  eq(pisqah.count, 2, 'per-type count for Pisqah');
}

// ----- estimateAccuracy -----
{
  // planned 15 wd; actual 20 wd (2/2..2/27 = 20 workdays) → ratio ~1.33
  const bs = [mk({ id: '1', actualStart: '2026-02-02', actualShip: '2026-02-27' })];
  const r = estimateAccuracy(bs, stages);
  eq(r.count, 1, 'accuracy sample count');
  ok(r.meanRatio > 1, 'overrun detected (ratio>1)');
  eq(r.overrunRate, 100, 'overrun rate 100% when all overran');
}

// ----- bottleneckAnalysis -----
{
  const bs = [
    mk({ id: '1', status: 'active', stageDurations: { frame: 4, mep: 10, finish: 3 } }),
    mk({ id: '2', status: 'active', stageDurations: { frame: 4, mep: 8, finish: 3 } }),
  ];
  const r = bottleneckAnalysis(bs, stages);
  eq(r.bottleneck.stageId, 'mep', 'bottleneck is the heaviest stage (MEP)');
  eq(r.rows.find((x) => x.stageId === 'mep').totalPlannedDays, 18, 'MEP total planned days summed');
  // completed builds excluded from bottleneck load
  const withDone = [...bs, mk({ id: '3', status: 'complete', actualShip: '2026-01-01', stageDurations: { frame: 99, mep: 0, finish: 0 } })];
  eq(bottleneckAnalysis(withDone, stages).rows.find((x) => x.stageId === 'frame').totalPlannedDays, 8, 'completed excluded from bottleneck');
}

// ----- lineUtilization -----
{
  // One build on Line B (cap 1), 10 workdays inside a 2-week (10-workday) window → ~100%
  const bs = [mk({ id: '1', status: 'active', lineId: 'B', confirmedStart: '2026-02-02', stageDurations: { frame: 10, mep: 0, finish: 0 } })];
  const r = lineUtilization(bs, lines, stages, {}, '2026-02-02', '2026-02-13');
  const bRow = r.find((x) => x.lineId === 'B');
  ok(bRow.utilization >= 90, 'line B near fully utilized');
  eq(bRow.state, 'constrained', 'high utilization flagged constrained');
  const aRow = r.find((x) => x.lineId === 'A');
  eq(aRow.state, 'underused', 'empty line flagged underused');
}

// ----- throughput -----
{
  const bs = [
    mk({ id: '1', actualShip: '2026-01-15' }),
    mk({ id: '2', actualShip: '2026-01-20' }),
    mk({ id: '3', actualShip: '2026-03-05' }),
  ];
  const r = throughput(bs, 6, '2026-03-31');
  eq(r.totalShipped, 3, 'throughput total shipped');
  const jan = r.series.find((s) => s.month === '2026-01');
  eq(jan.count, 2, 'January shipped 2');
  ok(r.series.length === 6, 'throughput seeds 6 months');
}

// ----- backlog -----
{
  const bs = [
    mk({ id: '1', status: 'active', stageDurations: { frame: 5, mep: 5, finish: 5 }, stageProgress: { frame: 1 } }), // 10 remaining
    mk({ id: '2', status: 'pipeline', stageDurations: { frame: 5, mep: 5, finish: 5 } }), // 15 remaining
  ];
  const r = backlog(bs, lines, stages);
  eq(r.remainingBuildDays, 25, 'backlog remaining days (10+15)');
  eq(r.activeBuilds, 1, 'active count');
  eq(r.pipelineBuilds, 1, 'pipeline count');
}

// ----- buildReport smoke -----
{
  const bs = [mk({ id: '1', status: 'active', lineId: 'A', confirmedStart: '2026-02-02' })];
  const r = buildReport(bs, lines, stages, {}, '2026-02-02');
  ok(r.onTime && r.cycle && r.bottleneck && r.utilization && r.throughput && r.backlog, 'buildReport assembles all sections');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (fails.length) { console.log('\n' + fails.join('\n')); process.exit(1); }
else console.log('All analytics tests passed ✓');
