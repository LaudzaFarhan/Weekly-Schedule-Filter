export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const BRANCH_WORKING_DAYS = {
  Bintaro: ['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  default: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
};

export const getWorkingDaysForBranch = (branchName) => {
  return BRANCH_WORKING_DAYS[branchName] || BRANCH_WORKING_DAYS.default;
};

// Short branch codes shown in compact UI (e.g. the workload heatmap cell tags).
export const BRANCH_CODES = {
  'Gading Serpong': 'GS',
  'Puri Indah': 'Puri',
  'Pondok Indah': 'PI',
  'Pluit Village': 'PV',
  'Kelapa Gading': 'KG',
  'Bekasi': 'BKS',
  'Bintaro': 'BTR',
};

/**
 * Resolve a short display code for a branch name. Falls back to the first two
 * characters (uppercased) when the branch isn't in the known map, so unmapped
 * or free-text branch names still render something sensible.
 */
export const getBranchCode = (branchName) => {
  if (!branchName) return '';
  const key = String(branchName).trim();
  if (BRANCH_CODES[key]) return BRANCH_CODES[key];
  // Case-insensitive lookup as a safety net for sheet typos / casing.
  const found = Object.keys(BRANCH_CODES).find(
    (b) => b.toLowerCase() === key.toLowerCase()
  );
  if (found) return BRANCH_CODES[found];
  return key.slice(0, 2).toUpperCase();
};

// Reverse lookups so we can turn a code ("BTR") or a full name back into a
// canonical branch name. Built once from BRANCH_CODES.
const CODE_TO_BRANCH = {};
const NAME_TO_BRANCH = {};
for (const [name, code] of Object.entries(BRANCH_CODES)) {
  CODE_TO_BRANCH[code.toLowerCase()] = name;
  NAME_TO_BRANCH[name.toLowerCase()] = name;
}

/**
 * Interpret a "Term-Branch" (column D) value as a cross-branch MEETING tag.
 *
 * The schedule sheets reuse column D for two different things:
 *   1. A normal class module code — e.g. "KF1", "K1.10", "Trial Kinder".
 *   2. A meeting scoped to specific branches, written as a comma/slash list of
 *      branch codes — e.g. "Puri, BTR" (Puri Indah + Bintaro) or "All Branch".
 *
 * A row of type (2) physically lives in whichever branch sheet it was typed
 * into, but it only "belongs" to the branches named in the tag. This lets the
 * workload view attribute such meetings to the right branches instead of the
 * sheet they happened to be entered on.
 *
 * @returns {null | { all: boolean, branches: string[] }}
 *   - null            → not a branch tag (treat as a normal class)
 *   - { all: true }   → applies to every branch ("All Branch")
 *   - { branches }    → applies only to the listed branch names
 */
export const parseMeetingBranches = (term) => {
  if (!term) return null;
  const raw = String(term).trim();
  if (!raw) return null;

  const lower = raw.toLowerCase();
  if (/^all\s*branch(es)?$/.test(lower)) {
    return { all: true, branches: [] };
  }

  // Split on comma or slash. Require 2+ tokens so a single module/branch cell
  // isn't accidentally reinterpreted as a meeting.
  const tokens = raw.split(/[,/]+/).map((t) => t.trim()).filter(Boolean);
  if (tokens.length < 2) return null;

  const resolved = [];
  for (const tok of tokens) {
    const t = tok.toLowerCase();
    const name = CODE_TO_BRANCH[t] || NAME_TO_BRANCH[t];
    if (!name) return null; // any non-branch token → this isn't a branch tag
    resolved.push(name);
  }
  return { all: false, branches: Array.from(new Set(resolved)) };
};

/**
 * Decide whether a class row belongs to a given branch.
 * - Meeting rows (column D is a branch list) belong only to the listed
 *   branches, regardless of which sheet they were entered on.
 * - "All Branch" meetings belong to every branch.
 * - Everything else belongs to the branch of the sheet it came from.
 */
export const classBelongsToBranch = (cls, branchName) => {
  if (!cls || !branchName) return false;
  const meeting = parseMeetingBranches(cls.program);
  if (meeting) {
    if (meeting.all) return true;
    return meeting.branches.includes(branchName);
  }
  return cls.branchName === branchName;
};

export const SCHEDULE_PAGE_SIZE = 8;
export const CARDS_PER_PAGE = 3;
export const LIST_PAGE_SIZE = 8;
