/**
 * Submit trial lead data.
 *
 * Routes the submission to the Apps Script URL configured for the
 * selected branch. If the branch carries no `trialUrl`, falls back to a
 * legacy default — that keeps older single-branch deployments working.
 *
 * `rowData` carries colA…colH plus optional `branchName` / `branchId`.
 * `branches` is the live branches array from ScheduleContext, so we can
 * look up the right URL.
 */
export async function submitTrialLead(rowData, { branches = [] } = {}) {
  const LEGACY_DEFAULT_URL = 'https://script.google.com/macros/s/AKfycbwYAGeTzu9Qw7kFhJQNhMVszA2tDu6yvGDkcrzt3Sf5zHIFwXHbe5DHU20-skw9rn2sMg/exec';

  // Find the branch that matches the picked branchId (or branchName as fallback).
  const branch = branches.find(
    (b) => b.id === rowData.branchId || b.name === rowData.branchName
  );

  // Pick the trial URL — branch's own URL, then env-level default, then legacy default.
  const targetUrl =
    (branch && (branch.trialUrl || branch.appsScriptUrl)) ||
    (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_TRIAL_URL_DEFAULT) ||
    LEGACY_DEFAULT_URL;

  if (!targetUrl) {
    throw new Error(
      `No trial submission URL configured for branch "${rowData.branchName || 'unknown'}". ` +
      `Add a Trial URL to the branch in Admin → Branches.`
    );
  }

  // We use no-cors because Apps Script doesn't return CORS headers for POSTs.
  // That means we can't read the response body, but the request still goes
  // through. The Apps Script side is responsible for actually appending.
  await fetch(targetUrl, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rowData),
  });

  return { success: true, method: 'apps-script-direct', url: targetUrl, branch: branch?.name || null };
}
