/**
 * Instructor Identity Utilities
 * 
 * Resolves instructor identity using Firebase profiles as source of truth.
 * Handles cross-branch matching and deduplication.
 */

/**
 * Build a lookup map of instructor identities from profiles and schedule data.
 * Each instructor gets a unique key based on their profile email (if available)
 * or a generated key from name + branch.
 * 
 * @param {Array} instructorProfiles - Firebase profiles
 * @param {Array} classes - All synced classes (overallClasses)
 * @returns {Map} Map of instructor name → identity object
 */
export function buildInstructorMap(instructorProfiles = [], classes = []) {
  const map = new Map();

  // 1. Profiles are the source of truth — they have unique IDs (email)
  instructorProfiles.forEach(profile => {
    const name = profile.fullname || profile.nickname || profile.id.split('@')[0];
    if (!name) return;

    map.set(name, {
      id: profile.id,
      name,
      branch: profile.location || 'Unknown',
      profileId: profile.id,
      specialization: profile.specialization || '',
      hasProfile: true,
    });
  });

  // 2. Fill in instructors from schedule data who don't have profiles yet
  classes.forEach(cls => {
    if (!cls.teacher || cls.teacher === '-') return;
    if (map.has(cls.teacher)) return; // Already resolved via profile

    map.set(cls.teacher, {
      id: `${cls.teacher}::${cls.branchName || 'unknown'}`,
      name: cls.teacher,
      branch: cls.branchName || 'Unknown',
      profileId: null,
      specialization: '',
      hasProfile: false,
    });
  });

  return map;
}

/**
 * Check if an instructor belongs to a specific branch.
 * An instructor "belongs" to a branch if:
 * - Their profile location matches the branch
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
  const profile = instructorProfiles.find(p => 
    p.fullname === instructorName || p.nickname === instructorName
  );

  if (profile) {
    if (profile.location === 'All Branches') return true;
    if (profile.location === branchName) return true;
  }

  // Check if they have classes in this branch
  const hasClassesInBranch = classes.some(
    c => c.teacher === instructorName && c.branchName === branchName
  );

  return hasClassesInBranch;
}

/**
 * Get the primary branch for an instructor.
 * Priority: profile.location > most classes in branch > first seen branch
 * 
 * @param {string} instructorName
 * @param {Array} instructorProfiles
 * @param {Array} overallClasses
 * @returns {string} Branch name
 */
export function getInstructorBranch(instructorName, instructorProfiles = [], overallClasses = []) {
  // 1. Check profile
  const profile = instructorProfiles.find(p => 
    p.fullname === instructorName || p.nickname === instructorName
  );
  if (profile && profile.location) return profile.location;

  // 2. Count classes per branch
  const branchCounts = {};
  overallClasses.forEach(cls => {
    if (cls.teacher === instructorName && cls.branchName) {
      branchCounts[cls.branchName] = (branchCounts[cls.branchName] || 0) + 1;
    }
  });

  // Return branch with most classes
  const sorted = Object.entries(branchCounts).sort((a, b) => b[1] - a[1]);
  if (sorted.length > 0) return sorted[0][0];

  return 'Unknown';
}
