/**
 * Google Sheets API helper — server-side only.
 * Stores/retrieves app config from a dedicated _AppConfig tab in the spreadsheet.
 *
 * Required env vars:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL   — service account email
 *   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY — private key (with literal \n)
 *   GOOGLE_SPREADSHEET_ID         — the actual spreadsheet ID (from the /edit URL)
 */

import { google } from 'googleapis';

const CONFIG_SHEET_NAME = '_AppConfig';
const CONFIG_KEYS = ['leaveList', 'trialPriority', 'disabledInstructors', 'featureToggles'];

let _sheets = null;
let _configured = null;

/**
 * Parse the service account credentials from a single JSON env var
 * or fall back to separate env vars.
 */
function getCredentials() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT) {
    try {
      const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
      return { email: sa.client_email, key: sa.private_key };
    } catch { return null; }
  }
  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    return {
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    };
  }
  return null;
}

/**
 * Check if Google Sheets API credentials are configured.
 */
export function isConfigured() {
  if (_configured !== null) return _configured;
  _configured = !!(getCredentials() && process.env.GOOGLE_SPREADSHEET_ID);
  return _configured;
}

/**
 * Get an authenticated Google Sheets API client.
 */
function getSheetsClient() {
  if (_sheets) return _sheets;

  const creds = getCredentials();
  const auth = new google.auth.JWT(
    creds.email,
    null,
    creds.key.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );

  _sheets = google.sheets({ version: 'v4', auth });
  return _sheets;
}

/**
 * Ensure the _AppConfig sheet exists. Creates it if missing.
 */
async function ensureConfigSheet() {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

  // Check if sheet exists
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets.some(
    (s) => s.properties.title === CONFIG_SHEET_NAME
  );

  if (!exists) {
    // Create the config sheet
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: { title: CONFIG_SHEET_NAME },
            },
          },
        ],
      },
    });

    // Add header row
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${CONFIG_SHEET_NAME}!A1:B1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['ConfigKey', 'ConfigValue']] },
    });

    console.log(`Created ${CONFIG_SHEET_NAME} sheet with headers.`);
  }
}

/**
 * Get all config values from the _AppConfig sheet.
 * Returns { leaveList: [...], trialPriority: [...], ... }
 */
export async function getAllConfig() {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

  await ensureConfigSheet();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${CONFIG_SHEET_NAME}!A2:B100`,
  });

  const rows = response.data.values || [];
  const config = {};

  for (const [key, value] of rows) {
    if (CONFIG_KEYS.includes(key)) {
      try {
        config[key] = JSON.parse(value);
      } catch {
        config[key] = value;
      }
    }
  }

  return config;
}

/**
 * Set a single config value in the _AppConfig sheet.
 */
export async function setConfigValue(key, value) {
  if (!CONFIG_KEYS.includes(key)) {
    throw new Error(`Invalid config key: ${key}`);
  }

  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

  await ensureConfigSheet();

  // Read existing rows to find if key already exists
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${CONFIG_SHEET_NAME}!A2:B100`,
  });

  const rows = response.data.values || [];
  const existingIndex = rows.findIndex(([k]) => k === key);
  const jsonValue = JSON.stringify(value);

  if (existingIndex >= 0) {
    // Update existing row (row index + 2 because of 1-indexed + header row)
    const rowNum = existingIndex + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${CONFIG_SHEET_NAME}!A${rowNum}:B${rowNum}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[key, jsonValue]] },
    });
  } else {
    // Append new row
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${CONFIG_SHEET_NAME}!A:B`,
      valueInputOption: 'RAW',
      requestBody: { values: [[key, jsonValue]] },
    });
  }

  return { success: true, key };
}

/**
 * Append a row of data to a specific sheet.
 */
export async function appendRow(sheetName, values) {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:Z`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] },
  });

  return { success: true };
}
