/**
 * Submit trial lead data to the server-side Next.js API.
 * The API will either use native Google Sheets API or proxy to Apps Script.
 */
export async function submitTrialLead(rowData) {
  // Use hardcoded URL to ensure it works exactly like Vite, avoiding Next.js .env issues
  const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwYAGeTzu9Qw7kFhJQNhMVszA2tDu6yvGDkcrzt3Sf5zHIFwXHbe5DHU20-skw9rn2sMg/exec';

  // Temporary fallback: hit Apps Script directly from the client exactly like the old Vite app did.
  console.log('Hitting Apps Script directly:', APPS_SCRIPT_URL);
  
  await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rowData),
  });
  
  return { success: true, method: 'apps-script-direct' };

  // Once configured, it will use the Next.js API natively
  const response = await fetch('/api/book-trial', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rowData),
  });

  if (!response.ok) {
    let errorMsg = 'Failed to submit trial';
    try {
      const errorData = await response.json();
      errorMsg = errorData.error || errorMsg;
    } catch {
      // ignore
    }
    throw new Error(errorMsg);
  }

  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error || 'Submission failed without error message');
  }

  return data;
}
