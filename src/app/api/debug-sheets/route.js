import { NextResponse } from 'next/server';
import { google } from 'googleapis';

/**
 * GET /api/debug-sheets
 * Debug: Write test data and verify if it sticks.
 */
export async function GET() {
  const log = [];

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

    // 1. Read BEFORE write
    log.push('Step 1: Reading A480:H480 BEFORE write...');
    const before = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'Trial'!A480:H480`,
    });
    log.push(`BEFORE: ${JSON.stringify(before.data.values || 'EMPTY')}`);

    // 2. Write test data
    log.push('Step 2: Writing test data to A480:H480...');
    const testData = ['API_WRITE_TEST', 'Trial Coder', 'Robot Student', 'TestBot', '2. Tuesday', '14:00', '2026-05-07', 'Written by API'];
    const writeRes = await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'Trial'!A480:H480`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [testData] },
    });
    log.push(`Write response: updatedCells=${writeRes.data.updatedCells}, updatedRange=${writeRes.data.updatedRange}, updatedRows=${writeRes.data.updatedRows}, updatedColumns=${writeRes.data.updatedColumns}`);

    // 3. Read AFTER write
    log.push('Step 3: Reading A480:H480 AFTER write...');
    const after = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'Trial'!A480:H480`,
    });
    log.push(`AFTER: ${JSON.stringify(after.data.values || 'EMPTY')}`);

    // 4. Also try writing to a simple cell A1 on a known area
    log.push('Step 4: Writing to Trial!Z1 as backup test...');
    const writeRes2 = await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'Trial'!Z1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['API_TEST_Z1']] },
    });
    log.push(`Z1 write: updatedCells=${writeRes2.data.updatedCells}`);

    return NextResponse.json({ success: true, log });
  } catch (e) {
    log.push(`ERROR: ${e.message}`);
    return NextResponse.json({ success: false, log, error: e.message });
  }
}
