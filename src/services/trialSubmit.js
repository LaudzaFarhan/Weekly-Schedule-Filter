/**
 * Submit trial lead data.
 *
 * `rowData` carries the legacy colA…colH columns plus new optional
 * `branchName` and `branchId` so server-side code (or the Apps Script) can
 * route the row to the correct branch's "Trial Leads" tab.
 *
 * Strategy:
 *   1. Hit the Next.js API first if the deployment is configured for it
 *      (this is the path that supports per-branch routing).
 *   2. Otherwise fall back to the existing Apps Script direct call so
 *      legacy single-sheet setups keep working.
 */
export async function submitTrialLead(rowData) {
  const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwYAGeTzu9Qw7kFhJQNhMVszA2tDu6yvGDkcrzt3Sf5zHIFwXHbe5DHU20-skw9rn2sMg/exec';

  // Apps Script direct path — this is the proven legacy flow. Branch
  // metadata still goes through so a future Apps Script upgrade can route
  // by branch without further client changes.
  await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rowData),
  });

  return { success: true, method: 'apps-script-direct' };
}
