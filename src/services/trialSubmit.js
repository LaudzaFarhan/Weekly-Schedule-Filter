/**
 * Submit trial lead data to the server-side Next.js API.
 * The API will either use native Google Sheets API or proxy to Apps Script.
 */
export async function submitTrialLead(rowData) {
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
