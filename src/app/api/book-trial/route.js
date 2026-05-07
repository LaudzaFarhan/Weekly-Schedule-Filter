import { NextResponse } from 'next/server';
import { isConfigured, appendRow } from '@/lib/googleSheets';

/**
 * POST /api/book-trial
 * Submits a new trial lead.
 * Uses native Google Sheets API if configured, otherwise proxies to existing Apps Script.
 */
export async function POST(request) {
  try {
    const body = await request.json();
    
    // Fallback: If Google Service Account is not set up, proxy to the old Apps Script
    if (!isConfigured()) {
      const APPS_SCRIPT_URL = process.env.NEXT_PUBLIC_APPS_SCRIPT_URL;
      
      if (!APPS_SCRIPT_URL) {
        return NextResponse.json(
          { error: 'System is not configured to accept trial bookings.' },
          { status: 500 }
        );
      }
      
      console.log('Proxying trial submission to Apps Script...');
      
      // We don't use 'no-cors' here because we are server-side and want to see the response if possible,
      // but Apps Script might still return redirect/opaque depending on how it's called.
      // fetch from Node.js bypasses browser CORS anyway.
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      
      // Even if response isn't pure JSON, we assume success if it didn't throw a network error
      // just like the old client-side logic did.
      return NextResponse.json({ success: true, method: 'apps-script' });
    }

    // Modern Flow: Use native Google Sheets API directly
    console.log('Using native Google Sheets API for trial submission...');
    
    // The existing TrialInputPage sends: colA, colB, colC, colD, colE, colF, colG, colH
    const values = [
      body.colA || 'Trial Leads',
      body.colB || '',
      body.colC || '',
      body.colD || '',
      body.colE || '',
      body.colF || '',
      body.colG || '',
      body.colH || ''
    ];

    // Assuming the tab is named "Trial Leads" since colA always sends "Trial Leads"
    const sheetName = 'Trial Leads'; 
    await appendRow(sheetName, values);

    return NextResponse.json({ success: true, method: 'native-api' });
    
  } catch (error) {
    console.error('Trial submission error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
