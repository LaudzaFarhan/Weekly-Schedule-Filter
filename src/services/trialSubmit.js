const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwYAGeTzu9Qw7kFhJQNhMVszA2tDu6yvGDkcrzt3Sf5zHIFwXHbe5DHU20-skw9rn2sMg/exec';

/**
 * Submit trial lead data to Google Sheets via Apps Script.
 */
export async function submitTrialLead(rowData) {
  const response = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rowData),
  });

  // no-cors returns opaque response, so we assume success if no network error
  return { success: true };
}
