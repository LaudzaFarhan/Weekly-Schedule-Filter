import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import packageJson from '../../../../package.json';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const SERVER_BOOT_TIME = Date.now();

function getBuildId() {
  try {
    const buildIdPath = path.join(process.cwd(), '.next', 'BUILD_ID');
    if (fs.existsSync(buildIdPath)) {
      const id = fs.readFileSync(buildIdPath, 'utf8').trim();
      if (id) return id;
    }
  } catch {}
  return process.env.NEXT_PUBLIC_BUILD_ID || process.env.BUILD_ID || `${packageJson.version}-${SERVER_BOOT_TIME}`;
}

const CURRENT_BUILD_ID = getBuildId();

export async function GET() {
  return NextResponse.json(
    {
      buildId: CURRENT_BUILD_ID,
      version: packageJson.version,
      serverBootTime: SERVER_BOOT_TIME,
      timestamp: Date.now(),
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    }
  );
}
