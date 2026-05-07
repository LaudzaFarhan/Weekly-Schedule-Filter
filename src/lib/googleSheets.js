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
      // Ensure private_key has real newlines (Vercel may double-escape them)
      let key = sa.private_key;
      if (key && !key.includes('-----BEGIN')) {
        // Key might be base64 or corrupted
        return null;
      }
      // Replace literal \n with real newlines if needed
      key = key.replace(/\\n/g, '\n');
      return { email: sa.client_email, key };
    } catch (e) {
      console.error('Failed to parse GOOGLE_SERVICE_ACCOUNT:', e.message);
      return null;
    }
  }
  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    return {
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n'),
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
  const auth = new google.auth.JWT({
    email: creds.email,
    key: creds.key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

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
 * Insert a row of data into a specific sheet at a fixed row (default: 480).
 * Pushes existing data below that row downward.
 */
export async function appendRow(sheetName, values, insertAtRow = 480) {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

  // Get the sheet ID and current grid size
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetMeta = meta.data.sheets.find(s => s.properties.title === sheetName);

  if (!sheetMeta) {
    throw new Error(`Sheet "${sheetName}" not found in the spreadsheet.`);
  }

  const sheetId = sheetMeta.properties.sheetId;
  const currentRowCount = sheetMeta.properties.gridProperties.rowCount;

  // If the sheet is too small, expand it first
  if (currentRowCount < insertAtRow) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          updateSheetProperties: {
            properties: {
              sheetId: sheetId,
              gridProperties: { rowCount: insertAtRow + 100 },
            },
            fields: 'gridProperties.rowCount',
          },
        }],
      },
    });
  }

  // Insert row + write data in a single atomic batchUpdate
  const cellData = values.map(v => ({
    userEnteredValue: { stringValue: String(v) },
  }));

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        // 1. Insert a blank row at the target position
        {
          insertDimension: {
            range: {
              sheetId: sheetId,
              dimension: 'ROWS',
              startIndex: insertAtRow - 1,
              endIndex: insertAtRow,
            },
            inheritFromBefore: true,
          },
        },
        // 2. Write data into the newly inserted row
        {
          updateCells: {
            start: {
              sheetId: sheetId,
              rowIndex: insertAtRow - 1,
              columnIndex: 0,
            },
            rows: [{ values: cellData }],
            fields: 'userEnteredValue',
          },
        },
      ],
    },
  });

  return { success: true };
}

