import { NextResponse } from 'next/server';
import { google } from 'googleapis';

/**
 * GET /api/debug-sheets
 * Temporary debug endpoint to test Google Sheets connection.
 * DELETE THIS FILE after debugging is complete.
 */
export async function GET() {
  const results = {
    step1_env_check: {},
    step2_parse: {},
    step3_auth: {},
    step4_sheets: {},
  };

  // Step 1: Check env vars exist
  results.step1_env_check = {
    GOOGLE_SERVICE_ACCOUNT_exists: !!process.env.GOOGLE_SERVICE_ACCOUNT,
    GOOGLE_SERVICE_ACCOUNT_length: process.env.GOOGLE_SERVICE_ACCOUNT?.length || 0,
    GOOGLE_SPREADSHEET_ID_exists: !!process.env.GOOGLE_SPREADSHEET_ID,
    GOOGLE_SPREADSHEET_ID: process.env.GOOGLE_SPREADSHEET_ID || 'NOT SET',
  };

  // Step 2: Try to parse the JSON
  let sa = null;
  try {
    sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    results.step2_parse = {
      success: true,
      client_email: sa.client_email,
      project_id: sa.project_id,
      private_key_starts_with: sa.private_key?.substring(0, 30),
      private_key_length: sa.private_key?.length,
      has_begin_marker: sa.private_key?.includes('-----BEGIN'),
    };
  } catch (e) {
    results.step2_parse = { success: false, error: e.message };
    return NextResponse.json(results);
  }

  // Step 3: Try to authenticate
  try {
    let key = sa.private_key.replace(/\\n/g, '\n');
    const auth = new google.auth.JWT({
      email: sa.client_email,
      key: key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    await auth.authorize();
    results.step3_auth = { success: true };
  } catch (e) {
    results.step3_auth = { success: false, error: e.message };
    return NextResponse.json(results);
  }

  // Step 4: Try to read the spreadsheet
  try {
    let key = sa.private_key.replace(/\\n/g, '\n');
    const auth = new google.auth.JWT({
      email: sa.client_email,
      key: key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID,
    });
    results.step4_sheets = {
      success: true,
      title: meta.data.properties.title,
      sheetCount: meta.data.sheets.length,
      sheetNames: meta.data.sheets.map(s => s.properties.title),
    };
  } catch (e) {
    results.step4_sheets = { success: false, error: e.message };
  }

  return NextResponse.json(results, { status: 200 });
}
