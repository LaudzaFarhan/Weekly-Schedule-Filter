/**
 * Instructor Identity Utilities
 * 
 * Resolves instructor identity using Firebase profiles as source of truth.
 * Handles cross-branch matching and deduplication.
 */

/**
 * Validates whether a string looks like a legitimate teacher name,
 * filtering out URLs, days of the week, and common placeholders.
 */
export function isValidTeacherName(name) {
  if (!name || name === '-') return false;
  const lower = name.toLowerCase();
  if (lower.startsWith('http')) return false;
  if (lower.includes('not assigned')) return false;
  
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  if (days.includes(lower)) return false;

  if (/^\d+$/.test(name.trim())) return false;
  if (lower === 'call') return false;
  
  // Reject program/event names mistakenly put in instructor columns
  const invalidKeywords = ['kinder', 'junior', 'coder', 'training'];
  if (invalidKeywords.some(kw => lower.includes(kw))) return false;

  return true;
}

/**
 * Build a lookup map of instructor identities from profiles and schedule data.
 * Each instructor gets a unique key based on their profile email (if available)
 * or a generated key from name + branch.
 * 
 * @param {Array} instructorProfiles - Firebase profiles
 * @param {Array} classes - All synced classes (overallClasses)
 * @returns {Map} Map of instructor name → identity object
 */
/**
 * Helper to get active verified alias strings for an instructor object.
 * Returns an array of verified alias strings.
 */
export function getVerifiedAliases(inst) {
  if (!inst) return [];
  if (Array.isArray(inst.verifiedAliases) && inst.verifiedAliases.length > 0) {
    return inst.verifiedAliases;
  }
  if (Array.isArray(inst.verified_aliases) && inst.verified_aliases.length > 0) {
    return inst.verified_aliases;
  }
  if (Array.isArray(inst.aliases)) {
    // If aliases array contains objects like { name, verified }
    const verified = inst.aliases
      .filter((a) => typeof a === 'object' ? a.verified : true)
      .map((a) => typeof a === 'object' ? a.name : a);
    return verified;
  }
  return [];
}

/**
 * Check if an instructor object matches a raw teacher name either by main name or verified alias.
 */
export function isInstructorMatch(rawName, inst) {
  if (!rawName || !inst) return false;
  const trimmed = String(rawName).trim();
  const instName = typeof inst === 'string' ? inst : (inst.name || inst.fullname || inst.nickname);
  
  if (instName && isSameTeacher(trimmed, instName)) {
    return true;
  }

  if (typeof inst === 'object') {
    const activeAliases = getVerifiedAliases(inst);
    for (const alias of activeAliases) {
      if (alias && (String(alias).toLowerCase().trim() === trimmed.toLowerCase() || isSameTeacher(trimmed, alias))) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Build a lookup map of instructor identities from profiles and schedule data.
 * Each instructor gets a unique key based on their profile email (if available)
 * or a generated key from name + branch.
 * 
 * @param {Array} instructorProfiles - Firebase / DB profiles
 * @param {Array} classes - All synced classes (overallClasses)
 * @returns {Map} Map of instructor name → identity object
 */
export function buildInstructorMap(instructorProfiles = [], classes = []) {
  const map = new Map();

  // 1. Profiles are the source of truth — they have unique IDs (email or Postgres ID)
  instructorProfiles.forEach(profile => {
    const name = profile.name || profile.fullname || profile.nickname || (profile.id ? String(profile.id).split('@')[0] : null);
    if (!name) return;

    const identity = {
      id: profile.id || name,
      name,
      branch: profile.location || (Array.isArray(profile.branches) ? profile.branches[0] : 'Unknown'),
      profileId: profile.id,
      specialization: profile.specialization || profile.level || '',
      aliases: profile.aliases || [],
      verifiedAliases: getVerifiedAliases(profile),
      hasProfile: true,
    };

    map.set(name, identity);

    // Map verified aliases to the same identity object
    const verified = getVerifiedAliases(profile);
    verified.forEach(alias => {
      if (alias && !map.has(alias)) {
        map.set(alias, identity);
      }
    });
  });

  // 2. Fill in instructors from schedule data who don't have profiles yet
  classes.forEach(cls => {
    if (!cls.teacher || cls.teacher === '-') return;
    if (map.has(cls.teacher)) return; // Already resolved via profile or alias

    map.set(cls.teacher, {
      id: `${cls.teacher}::${cls.branchName || 'unknown'}`,
      name: cls.teacher,
      branch: cls.branchName || 'Unknown',
      profileId: null,
      specialization: '',
      aliases: [],
      verifiedAliases: [],
      hasProfile: false,
    });
  });

  return map;
}

/**
 * Check if an instructor belongs to a specific branch.
 * An instructor "belongs" to a branch if:
 * - Their profile location/branches matches the branch
 * - Their profile location is "All Branches"
 * - They have classes in that branch's schedule
 * 
 * @param {string} instructorName
 * @param {string} branchName
 * @param {Array} instructorProfiles
 * @param {Array} classes - classes filtered to the target branch
 * @returns {boolean}
 */
export function instructorBelongsToBranch(instructorName, branchName, instructorProfiles = [], classes = []) {
  // Check profile location
  const profile = instructorProfiles.find(p => isInstructorMatch(instructorName, p));

  if (profile) {
    if (profile.location === 'All Branches' || (Array.isArray(profile.branches) && profile.branches.includes('All Branches'))) return true;
    if (profile.location === branchName || (Array.isArray(profile.branches) && profile.branches.includes(branchName))) return true;
  }

  // Check if they have classes in this branch
  const hasClassesInBranch = classes.some(
    c => (c.teacher === instructorName || isSameTeacher(c.teacher, instructorName)) && c.branchName === branchName
  );

  return hasClassesInBranch;
}

/**
 * Get the primary branch for an instructor.
 * Priority: profile.location/branches > most classes in branch > first seen branch
 * 
 * @param {string} instructorName
 * @param {Array} instructorProfiles
 * @param {Array} overallClasses
 * @returns {string} Branch name
 */
export function getInstructorBranch(instructorName, instructorProfiles = [], overallClasses = []) {
  // 1. Check profile
  const profile = instructorProfiles.find(p => isInstructorMatch(instructorName, p));
  if (profile) {
    if (profile.location) return profile.location;
    if (Array.isArray(profile.branches) && profile.branches.length > 0) return profile.branches[0];
  }

  // 2. Count classes per branch
  const branchCounts = {};
  overallClasses.forEach(cls => {
    if ((cls.teacher === instructorName || isSameTeacher(cls.teacher, instructorName)) && cls.branchName) {
      branchCounts[cls.branchName] = (branchCounts[cls.branchName] || 0) + 1;
    }
  });

  // Return branch with most classes
  const sorted = Object.entries(branchCounts).sort((a, b) => b[1] - a[1]);
  if (sorted.length > 0) return sorted[0][0];

  return 'Unknown';
}

/**
 * Flexible comparison between two teacher names (handles nicknames, partial names, casing).
 * e.g., "Ziyah" matches "FAUZIYAH AMIRA ZAHRA", "Helen" matches "HELEN TERESIA".
 */
export function isSameTeacher(t1, t2) {
  if (!t1 || !t2) return false;
  const s1 = String(t1).toLowerCase().trim();
  const s2 = String(t2).toLowerCase().trim();
  if (s1 === s2) return true;

  // Common nickname aliases map (bidirectional lookup)
  const ALIAS_MAP = {
    ziyah: 'fauziyah',
    fauziyah: 'ziyah',
    abel: 'annabel',
    annabel: 'abel',
    olga: 'annabel',
  };

  const norm1 = ALIAS_MAP[s1] || s1;
  const norm2 = ALIAS_MAP[s2] || s2;
  if (norm1 === norm2) return true;

  // Check direct alias or substring match between full strings
  if (s1.includes(s2) || s2.includes(s1)) return true;
  if (norm1.includes(norm2) || norm2.includes(norm1)) return true;

  // Token matching (ignoring generic prefix words)
  const GENERIC_TOKENS = new Set(['teacher', 'guru', 'instructor', 'mr', 'ms', 'mrs', 'kak', 'pak', 'ibu']);
  const tokens1 = norm1.split(/\s+/).filter((t) => t.length >= 3 && !GENERIC_TOKENS.has(t)).map((t) => ALIAS_MAP[t] || t);
  const tokens2 = norm2.split(/\s+/).filter((t) => t.length >= 3 && !GENERIC_TOKENS.has(t)).map((t) => ALIAS_MAP[t] || t);

  for (const tok1 of tokens1) {
    for (const tok2 of tokens2) {
      if (
        tok1 === tok2 ||
        ALIAS_MAP[tok1] === tok2 ||
        ALIAS_MAP[tok2] === tok1 ||
        (tok1.length >= 3 && tok2.length >= 3 && (tok1.includes(tok2) || tok2.includes(tok1)))
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Resolve a raw teacher name string against a list of known instructor objects/names.
/**
 * Helper to get the primary display name for an instructor (Alias > Name).
 * Prefers the first verified alias if set, otherwise the instructor's name.
 */
export function getInstructorDisplayName(inst) {
  if (!inst) return '';
  if (typeof inst === 'string') return inst;

  if (inst.nickname && String(inst.nickname).trim()) {
    return String(inst.nickname).trim();
  }

  const verified = getVerifiedAliases(inst);
  if (verified.length > 0 && verified[0]) {
    return String(verified[0]).trim();
  }

  const aliases = Array.isArray(inst.aliases) ? inst.aliases : [];
  if (aliases.length > 0 && aliases[0]) {
    const aliasStr = typeof aliases[0] === 'object' ? aliases[0].name : aliases[0];
    if (aliasStr) return String(aliasStr).trim();
  }

  return inst.name || inst.fullname || String(inst.id || '').split('@')[0] || '';
}

/**
 * Resolve a raw teacher name string against a list of known instructor objects/names.
 * Returns the canonical alias or display name if matched, or the trimmed raw name if no match is found.
 */
export function resolveCanonicalTeacherName(rawName, knownInstructors = []) {
  if (!rawName) return 'TBD';
  const trimmed = String(rawName).trim();
  if (!trimmed || trimmed === '-' || trimmed.toUpperCase() === 'TBD') return 'TBD';

  for (const inst of knownInstructors) {
    if (!inst) continue;
    if (isInstructorMatch(trimmed, inst)) {
      const displayName = getInstructorDisplayName(inst);
      if (displayName && displayName !== 'TBD' && (displayName.length <= trimmed.length || !trimmed.includes(' '))) {
        return displayName;
      }
      return trimmed;
    }
  }

  return trimmed;
}

/**
 * Scan imported schedule teacher names and extract recommended alias names for an instructor profile.
 * Returns array of recommended alias strings that are present in the schedule but not yet saved in currentAliases.
 *
 * @param {string} instructorName - The primary name of the instructor (e.g. "FAUZIYAH AMIRA ZAHRA")
 * @param {Array<string>} currentAliases - Already saved aliases for this instructor
 * @param {Array<string>} importedTeacherNames - List/Set of all teacher names present in imported schedule data
 * @returns {Array<string>} List of recommended alias strings
 */
export function getRecommendedAliases(instructorName, currentAliases = [], importedTeacherNames = []) {
  if (!instructorName) return [];
  const canonicalNameLower = String(instructorName).toLowerCase().trim();
  const existingLower = new Set(
    (currentAliases || []).map((a) => String(typeof a === 'object' ? a.name : a).toLowerCase().trim())
  );
  existingLower.add(canonicalNameLower);

  const recommendations = [];

  for (const rawTeacher of importedTeacherNames) {
    if (!rawTeacher || rawTeacher === '-' || !isValidTeacherName(rawTeacher)) continue;
    const rawTrimmed = String(rawTeacher).trim();
    const rawLower = rawTrimmed.toLowerCase();
    
    // Skip if already equals instructor name or is in existing aliases
    if (existingLower.has(rawLower)) continue;

    // Check if imported teacher name matches instructor identity
    if (isSameTeacher(rawTrimmed, instructorName)) {
      recommendations.push(rawTrimmed);
      existingLower.add(rawLower); // prevent duplicates
    }
  }

  return recommendations;
}

