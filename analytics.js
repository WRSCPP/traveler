/**
 * Traveler Analytics Engine
 * ------------------------------------------------------------------
 * Pure, dependency-free reporting logic built on top of the planning engine.
 * These functions turn raw build data into the metrics a modular-home
 * manufacturer needs to make decisions: are we shipping on time, where's the
 * bottleneck, how loaded is each line, how long do builds actually take, and
 * are those numbers getting better or worse over time.
 *
 * Like engine.js, everything here is a pure function of its inputs so it can be
 * unit-tested in isolation and reused on a server or in the browser unchanged.
 *
 * Conventions:
 *  - "completed build" = status === 'complete' AND has an actualShip date.
 *  - Metrics that need actuals ignore builds lacking the relevant dates rather
 *    than guessing, and report how many were excluded so the number is honest.
 *
 * Extended build shape this engine can use (all optional, degrade gracefully):
 *   actualShip       ISO date the build actually shipped
 *   actualStart      ISO date work actually began
 *   stageProgress    { [stageId]: 0..1 }
 *   stageActuals     { [stageId]: { start, end } }  actual per-stage dates
 */

import {
  toISO, toDate, diffDays, countWorkdays, addDays,
  effectiveStart, buildDuration, projectBuild, forecastBuild,
} from './engine.js';

// ----------------------------- small helpers -----------------------------

function mean(nums) { return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0; }
function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function round(n, dp = 1) { const f = 10 ** dp; return Math.round(n * f) / f; }
function monthKey(iso) { return iso ? iso.slice(0, 7) : null; } // 'YYYY-MM'

/** Builds considered genuinely finished (have an actual ship date). */
export function completedBuilds(builds) {
  return builds.filter((b) => b.status === 'complete' && b.actualShip);
}

// ----------------------------- On-time delivery -----------------------------

/**
 * On-time delivery performance for completed builds: did actualShip land on or
 * before targetShip? Reports rate plus the average lateness of the ones that
 * slipped (in working days), which is the number that actually hurts.
 */
export function onTimeDelivery(builds, calendar = {}) {
  const done = completedBuilds(builds).filter((b) => b.targetShip);
  const excluded = completedBuilds(builds).length - done.length;
  if (!done.length) return { rate: null, onTime: 0, late: 0, total: 0, avgLatenessDays: 0, excluded };

  let onTime = 0, late = 0;
  const latenessDays = [];
  for (const b of done) {
    const slip = diffDays(b.targetShip, b.actualShip); // >0 means shipped after target
    if (slip <= 0) onTime++;
    else {
      late++;
      latenessDays.push(countWorkdays(addDays(b.targetShip, 1), b.actualShip, calendar));
    }
  }
  return {
    rate: round(onTime / done.length * 100),
    onTime, late, total: done.length,
    avgLatenessDays: round(mean(latenessDays)),
    excluded,
  };
}

// ----------------------------- Cycle time -----------------------------

/**
 * Cycle time = calendar (or working) days from actual start to actual ship.
 * Returns mean/median in working days, plus a per-module-type breakdown so you
 * can see, e.g., that a Cascade takes materially longer than a Pisqah.
 */
export function cycleTime(builds, calendar = {}) {
  const done = completedBuilds(builds).filter((b) => b.actualStart && b.actualShip);
  const excluded = completedBuilds(builds).length - done.length;
  const days = done.map((b) => countWorkdays(b.actualStart, b.actualShip, calendar));

  const byType = {};
  for (const b of done) {
    const key = b.moduleType || '(none)';
    (byType[key] ||= []).push(countWorkdays(b.actualStart, b.actualShip, calendar));
  }
  const perType = Object.entries(byType).map(([type, arr]) => ({
    type, count: arr.length, meanDays: round(mean(arr)), medianDays: round(median(arr)),
  })).sort((a, b) => b.count - a.count);

  return {
    count: done.length,
    meanDays: round(mean(days)),
    medianDays: round(median(days)),
    minDays: days.length ? Math.min(...days) : 0,
    maxDays: days.length ? Math.max(...days) : 0,
    perType,
    excluded,
  };
}

// ----------------------------- Estimate accuracy -----------------------------

/**
 * How good are our plans? Compares planned duration (sum of stage durations)
 * against actual cycle time for completed builds. A ratio > 1 means builds take
 * longer than planned — the number that tells you whether to pad estimates.
 */
export function estimateAccuracy(builds, stages, calendar = {}) {
  const done = completedBuilds(builds).filter((b) => b.actualStart && b.actualShip);
  const rows = done.map((b) => {
    const planned = buildDuration(b, stages);
    const actual = countWorkdays(b.actualStart, b.actualShip, calendar);
    return { buildId: b.id, name: b.name, plannedDays: planned, actualDays: actual, ratio: planned ? round(actual / planned, 2) : null };
  }).filter((r) => r.ratio !== null);

  const ratios = rows.map((r) => r.ratio);
  return {
    count: rows.length,
    meanRatio: round(mean(ratios), 2),
    medianRatio: round(median(ratios), 2),
    overrunRate: rows.length ? round(rows.filter((r) => r.ratio > 1).length / rows.length * 100) : 0,
    rows: rows.sort((a, b) => b.ratio - a.ratio),
  };
}

// ----------------------------- Bottleneck analysis -----------------------------

/**
 * Which stage eats the most time and most often runs behind? Aggregates planned
 * days per stage across active builds, and — where stage actuals exist — how
 * often a stage overran its plan. The stage with the highest total load and/or
 * overrun frequency is your bottleneck to attack.
 */
export function bottleneckAnalysis(builds, stages) {
  const active = builds.filter((b) => b.status !== 'complete');
  const rows = stages.map((s) => {
    let totalPlanned = 0, count = 0, overruns = 0, overrunSamples = 0, inProgress = 0;
    for (const b of active) {
      const planned = b.stageDurations?.[s.id] || 0;
      if (planned > 0) { totalPlanned += planned; count++; }
      const prog = b.stageProgress?.[s.id] || 0;
      if (prog > 0 && prog < 1) inProgress++;
      const act = b.stageActuals?.[s.id];
      if (act?.start && act?.end) {
        overrunSamples++;
        const actualDays = countWorkdays(act.start, act.end);
        if (actualDays > planned) overruns++;
      }
    }
    return {
      stageId: s.id, label: s.label, order: s.order,
      totalPlannedDays: totalPlanned,
      buildsUsing: count,
      avgPlannedDays: count ? round(totalPlanned / count) : 0,
      inProgressNow: inProgress,
      overrunRate: overrunSamples ? round(overruns / overrunSamples * 100) : null,
    };
  });
  const ranked = [...rows].sort((a, b) => b.totalPlannedDays - a.totalPlannedDays);
  return { rows, topByLoad: ranked.slice(0, 3), bottleneck: ranked[0] || null };
}

// ----------------------------- Line utilization -----------------------------

/**
 * How hard is each line working over a window? Utilization = booked build-days
 * on the line ÷ available capacity-days (capacity × working days in the window).
 * Over ~85% means the line is a constraint; under ~40% means slack you could
 * sell into. This is the "can we take another order?" number.
 */
export function lineUtilization(builds, lines, stages, calendar = {}, windowStart, windowEnd) {
  const start = windowStart || toISO(new Date());
  const end = windowEnd || addDays(start, 90);
  const workingDaysInWindow = countWorkdays(start, end, calendar);

  const projections = {};
  for (const b of builds) { const p = projectBuild(b, stages, calendar); if (p) projections[b.id] = p; }

  return lines.map((line) => {
    const lineBuilds = builds.filter((b) => b.lineId === line.id && b.status !== 'complete');
    let bookedDays = 0;
    for (const b of lineBuilds) {
      const p = projections[b.id];
      if (!p) continue;
      // overlap of [p.start, p.projectedShip] with [start, end], in working days
      const ovStart = p.start > start ? p.start : start;
      const ovEnd = p.projectedShip < end ? p.projectedShip : end;
      if (diffDays(ovStart, ovEnd) >= 0) bookedDays += countWorkdays(ovStart, ovEnd, calendar);
    }
    const capacityDays = (line.capacity || 1) * workingDaysInWindow;
    const utilization = capacityDays ? round(bookedDays / capacityDays * 100) : 0;
    return {
      lineId: line.id, lineName: line.name, capacity: line.capacity,
      bookedDays, capacityDays, utilization,
      state: utilization >= 85 ? 'constrained' : utilization >= 40 ? 'balanced' : 'underused',
      assignedBuilds: lineBuilds.length,
    };
  });
}

// ----------------------------- Throughput & trend -----------------------------

/**
 * Throughput: how many builds shipped per month, from actualShip dates.
 * Returns a sorted series plus a simple trend (comparing the most recent months
 * to the prior ones) so you can see if output is climbing or slipping.
 */
export function throughput(builds, monthsBack = 12, today = toISO(new Date())) {
  const done = completedBuilds(builds);
  const counts = {};
  // seed the last N months with 0 so gaps show as zero, not missing
  const now = toDate(today);
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    counts[toISO(d).slice(0, 7)] = 0;
  }
  for (const b of done) {
    const k = monthKey(b.actualShip);
    if (k && k in counts) counts[k]++;
  }
  const series = Object.entries(counts).map(([month, count]) => ({ month, count }));

  // trend: mean of last third vs prior two-thirds
  const vals = series.map((s) => s.count);
  const split = Math.max(1, Math.floor(vals.length / 3));
  const recent = mean(vals.slice(-split));
  const prior = mean(vals.slice(0, -split));
  let direction = 'flat';
  if (recent > prior * 1.1) direction = 'up';
  else if (recent < prior * 0.9) direction = 'down';

  return { series, totalShipped: done.length, recentAvg: round(recent), priorAvg: round(prior), direction };
}

// ----------------------------- Workload / backlog -----------------------------

/**
 * Backlog of remaining work: total planned working days still to do across all
 * non-complete builds, and how many weeks that represents at current capacity.
 * Answers "how deep is our commitment book?"
 */
export function backlog(builds, lines, stages) {
  const notComplete = builds.filter((b) => b.status !== 'complete');
  let remainingDays = 0;
  for (const b of notComplete) {
    for (const s of stages) {
      const planned = b.stageDurations?.[s.id] || 0;
      const prog = Math.min(Math.max(b.stageProgress?.[s.id] || 0, 0), 1);
      remainingDays += planned * (1 - prog);
    }
  }
  const totalCapacityPerDay = lines.reduce((sum, l) => sum + (l.capacity || 0), 0) || 1;
  const workingDaysOfBacklog = round(remainingDays / totalCapacityPerDay);
  return {
    remainingBuildDays: Math.round(remainingDays),
    activeBuilds: builds.filter((b) => b.status === 'active').length,
    pipelineBuilds: builds.filter((b) => b.status === 'pipeline').length,
    weeksOfWork: round(workingDaysOfBacklog / 5),
  };
}

// ----------------------------- Master report -----------------------------

/**
 * One call that assembles the full analytics picture for the reporting view.
 */
export function buildReport(builds, lines, stages, calendar = {}, today = toISO(new Date())) {
  return {
    generatedAt: today,
    onTime: onTimeDelivery(builds, calendar),
    cycle: cycleTime(builds, calendar),
    accuracy: estimateAccuracy(builds, stages, calendar),
    bottleneck: bottleneckAnalysis(builds, stages),
    utilization: lineUtilization(builds, lines, stages, calendar, today, addDays(today, 90)),
    throughput: throughput(builds, 12, today),
    backlog: backlog(builds, lines, stages),
  };
}
