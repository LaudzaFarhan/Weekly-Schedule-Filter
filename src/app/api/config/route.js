import { NextResponse } from 'next/server';
import { isConfigured, getAllConfig, setConfigValue } from '@/lib/googleSheets';

/**
 * GET /api/config
 * Returns all config from Google Sheets.
 * Falls back to a "not configured" response if credentials are missing.
 */
export async function GET() {
  if (!isConfigured()) {
    return NextResponse.json(
      { configured: false, message: 'Google Sheets API not configured — using localStorage only' },
      { status: 200 }
    );
  }

  try {
    const config = await getAllConfig();
    return NextResponse.json({ configured: true, ...config });
  } catch (error) {
    console.error('Config GET error:', error);
    return NextResponse.json(
      { configured: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/config
 * Body: { key: "leaveList"|"trialPriority"|..., value: <any> }
 * Saves a single config value to Google Sheets.
 */
export async function POST(request) {
  if (!isConfigured()) {
    return NextResponse.json(
      { configured: false, message: 'Google Sheets API not configured — saved to localStorage only' },
      { status: 200 }
    );
  }

  try {
    const body = await request.json();
    const { key, value } = body;

    if (!key || value === undefined) {
      return NextResponse.json(
        { error: 'Missing key or value' },
        { status: 400 }
      );
    }

    const result = await setConfigValue(key, value);
    return NextResponse.json({ configured: true, ...result });
  } catch (error) {
    console.error('Config POST error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
