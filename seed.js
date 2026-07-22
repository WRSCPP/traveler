/**
 * Seed data — the real builds, production lines, and stages.
 * Loaded once on first run (when storage is empty), then persisted.
 * After that, all edits live in IndexedDB; this file is only the starting point.
 */

export const SEED_STAGES = [
  { id: 'framing',          label: 'Framing',              order: 1,  defaultDays: 4 },
  { id: 'rough-mech',       label: 'Rough-in — Mechanical',order: 2,  defaultDays: 2 },
  { id: 'rough-elec',       label: 'Rough-in — Electrical',order: 3,  defaultDays: 2 },
  { id: 'rough-plumb',      label: 'Rough-in — Plumbing',  order: 4,  defaultDays: 2 },
  { id: 'insulation',       label: 'Insulation',           order: 5,  defaultDays: 2 },
  { id: 'interior-skins',   label: 'Interior Skins',       order: 6,  defaultDays: 3 },
  { id: 'roofing',          label: 'Roofing',              order: 7,  defaultDays: 2 },
  { id: 'exterior-finish',  label: 'Exterior Finish',      order: 8,  defaultDays: 4 },
  { id: 'finish-mech',      label: 'Finish — Mechanical',  order: 9,  defaultDays: 2 },
  { id: 'finish-elec',      label: 'Finish — Electrical',  order: 10, defaultDays: 2 },
  { id: 'finish-plumb',     label: 'Finish — Plumbing',    order: 11, defaultDays: 2 },
  { id: 'interior-finish',  label: 'Interior Finish',      order: 12, defaultDays: 4 },
  { id: 'cabinet',          label: 'Cabinet Shop',         order: 13, defaultDays: 3 },
  { id: 'tile',             label: 'Tile',                 order: 14, defaultDays: 2 },
  { id: 'interior-paint',   label: 'Interior Paint',       order: 15, defaultDays: 3 },
  { id: 'exterior-paint',   label: 'Exterior Paint',       order: 16, defaultDays: 2 },
  { id: 'clean-pack',       label: 'Clean/Pack',           order: 17, defaultDays: 2 },
];

export const SEED_LINES = [
  { id: 'line-1', name: 'Long Line', capacity: 10, workdaysPerWeek: 5 },
  { id: 'line-2', name: 'Short Line', capacity: 6, workdaysPerWeek: 5 },
  { id: 'yard',   name: 'Yard / Staging', capacity: 4, workdaysPerWeek: 5 },
];

export const MODULE_TYPES = ['Pisqah', 'Cascade', 'Rogue', 'Tellico'];

// A reasonable default per-stage duration (working days) applied to seeded builds.
// These are starting estimates the planner uses until you tune them per build.
const DEFAULT_DURATIONS = {
  framing: 4, 'rough-mech': 2, 'rough-elec': 2, 'rough-plumb': 2, insulation: 2,
  'interior-skins': 3, roofing: 2, 'exterior-finish': 4, 'finish-mech': 2,
  'finish-elec': 2, 'finish-plumb': 2, 'interior-finish': 4, cabinet: 3,
  tile: 2, 'interior-paint': 3, 'exterior-paint': 2, 'clean-pack': 2,
};

function build(id, name, client, moduleType, over = {}) {
  return {
    id, name, client, moduleType,
    lineId: 'line-1',
    status: 'pipeline',
    confirmedStart: null,
    tentativeStart: null,
    targetShip: null,
    actualStart: null,       // set when work actually begins
    actualShip: null,        // set when the build actually ships (drives history metrics)
    stageDurations: { ...DEFAULT_DURATIONS },
    stageProgress: {},
    stageHours: {},        // actual hours logged per stage
    projectedHours: 0,     // projected total build hours
    stageCrew: {},          // { [stageId]: [personId, ...] } — people assigned to each stage
    inspectionStatus: {},   // { [inspectionId]: 'not-scheduled'|'scheduled'|'passed'|'failed' }
    stageStatus: {},        // { [stageId]: 'not-started'|'in-progress'|'complete'|'na' }
    stageActuals: {},       // { [stageId]: { start, end } }
    materials: [],
    bay: null,              // which numbered bay on the line this build occupies
    priority: 100,
    notes: '',
    ...over,
  };
}

// A completed build with real actual dates, for analytics history.
function pastBuild(id, name, client, moduleType, lineId, actualStart, actualShip, targetShip) {
  return build(id, name, client, moduleType, {
    lineId, status: 'complete', confirmedStart: actualStart, targetShip,
    actualStart, actualShip,
    stageProgress: Object.fromEntries(Object.keys(DEFAULT_DURATIONS).map((k) => [k, 1])),
  });
}

export const SEED_BUILDS = [
  build('mod-0101', 'Ofland Workforce Housing — Mod A', 'Ofland', ''),
  build('mod-0102', 'Ofland Workforce Housing — Mod B', 'Ofland', ''),
  build('mod-0103', 'Tomi #1', 'Tomi', 'Pisqah'),
  build('mod-0104', 'Tomi #2', 'Tomi', 'Pisqah'),
  build('mod-0105', 'Chatt Land Bank — Mod A', 'Chatt Land Bank', 'Cascade'),
  build('mod-0106', 'Chatt Land Bank — Mod B', 'Chatt Land Bank', 'Cascade'),
  build('mod-0107', 'Bounty Club Comfort Station', 'Bounty Club', 'Pisqah'),
  build('mod-0108', 'Bounty Club Guardhouse', 'Bounty Club', 'Rogue'),
  build('mod-0109', 'Nokken', 'Nokken', ''),
  build('mod-0110', 'Freeman', 'Freeman', 'Tellico'),

  // --- Historical completed builds (give the Reports tab real data to show) ---
  pastBuild('mod-0088', 'Cedar Ridge — Unit 1', 'Cedar Ridge Co-op', 'Pisqah', 'line-1', '2025-11-03', '2025-12-05', '2025-12-01'), // late
  pastBuild('mod-0089', 'Cedar Ridge — Unit 2', 'Cedar Ridge Co-op', 'Pisqah', 'line-1', '2025-11-17', '2025-12-12', '2025-12-19'), // on time
  pastBuild('mod-0090', 'Harbor View ADU', 'Harbor View LLC', 'Cascade', 'line-2', '2025-12-01', '2026-01-16', '2026-01-15'),        // ~on time
  pastBuild('mod-0091', 'Meadowbrook Cabin', 'Meadowbrook', 'Rogue', 'line-2', '2026-01-05', '2026-01-30', '2026-02-06'),           // on time
  pastBuild('mod-0092', 'Tellico Pines — A', 'Tellico Pines', 'Tellico', 'line-1', '2026-01-12', '2026-02-20', '2026-02-13'),        // late
  pastBuild('mod-0093', 'Tellico Pines — B', 'Tellico Pines', 'Tellico', 'line-1', '2026-02-02', '2026-03-06', '2026-03-13'),        // on time
  pastBuild('mod-0094', 'Willow Creek Studio', 'Willow Creek', 'Pisqah', 'line-2', '2026-02-16', '2026-03-13', '2026-03-20'),        // on time
  pastBuild('mod-0095', 'Stonefield Guesthouse', 'Stonefield', 'Cascade', 'line-1', '2026-03-02', '2026-04-17', '2026-04-10'),       // late
];

export const SEED_SETTINGS = {
  moduleTypes: MODULE_TYPES,
  // Crew roles — managed separately so they can be assigned from a dropdown.
  roles: ['Framer', 'Electrician', 'Plumber', 'Finisher', 'Mechanic', 'Painter'],
  // Crew members — individuals with a simple role and a weekly labor-hour capacity.
  people: [
    { id: 'p-1', name: 'Alex Rivera', role: 'Framer', weeklyHours: 40 },
    { id: 'p-2', name: 'Sam Chen', role: 'Electrician', weeklyHours: 40 },
    { id: 'p-3', name: 'Jordan Blake', role: 'Plumber', weeklyHours: 40 },
    { id: 'p-4', name: 'Casey Morgan', role: 'Finisher', weeklyHours: 40 },
  ],
  // Standard inspection points every build passes through (customizable in Settings).
  inspections: [
    { id: 'insp-framing', label: 'Framing Inspection' },
    { id: 'insp-rough-elec', label: 'Rough Electrical' },
    { id: 'insp-rough-plumb', label: 'Rough Plumbing' },
    { id: 'insp-insulation', label: 'Insulation' },
    { id: 'insp-final', label: 'Final / Module Close-up' },
  ],
  healthStatuses: [
    { id: 'on-track', label: 'On Track', color: '#157A6E' },
    { id: 'at-risk', label: 'At Risk', color: '#CE8214' },
    { id: 'delayed', label: 'Delayed', color: '#C44F3A' },
  ],
  stageStatuses: [
    { id: 'not-started', label: 'Not Started', color: '#90A09F' },
    { id: 'in-progress', label: 'In Progress', color: '#CE8214' },
    { id: 'complete', label: 'Complete', color: '#157A6E' },
    { id: 'na', label: 'N/A', color: '#CCD8D4' },
  ],
  holidays: [],
};
