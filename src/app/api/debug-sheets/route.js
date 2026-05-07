import { NextResponse } from 'next/server';
import { google } from 'googleapis';

/**
 * GET /api/debug-sheets
 * Temporary debug endpoint to test Google Sheets write operations.
 */
export async function GET() {
  const results = {};

  try {
    const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    let key = sa.private_key.replace(/\\n/g, '\n');
    
    const auth = new google.auth.JWT({
      email: sa.client_email,
      key: key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

    // Step 1: Get sheet info
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const trialSheet = meta.data.sheets.find(s => s.properties.title === 'Trial');
    results.sheetId = trialSheet?.properties?.sheetId;
    results.rowCount = trialSheet?.properties?.gridProperties?.rowCount;

    // Step 2: Try a simple values.update to cell A480
    const writeResult = await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'Trial'!A480:H480`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { 
        values: [['DEBUG TEST', 'Trial Coder', 'Debug Student', 'TestInstructor', '2. Tuesday', '13:00-14:00', '2026-05-19', 'Debug Write Test']] 
      },
    });
    results.writeResult = {
      updatedCells: writeResult.data.updatedCells,
      updatedRange: writeResult.data.updatedRange,
      updatedRows: writeResult.data.updatedRows,
    };

    // Step 3: Read back row 480 to verify
    const readResult = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'Trial'!A480:H480`,
    });
    results.readBack = readResult.data.values || 'EMPTY - NO DATA';

    return NextResponse.json({ success: true, results });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message, results });
  }
}
