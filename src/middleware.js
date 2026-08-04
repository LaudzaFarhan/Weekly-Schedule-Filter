import { NextResponse } from 'next/server';

/**
 * Lightweight gate for the New Operations API.
 *
 * Goal: stop anonymous internet traffic from reading or deleting operational
 * data, without breaking the app's own browser calls.
 *
 * Two ways in:
 *  1. Same-origin requests from the app itself (the browser sets
 *     `Sec-Fetch-Site: same-origin`, which page JS cannot forge).
 *  2. A bearer token matching NEW_OPS_API_KEY — for Hermes, scripts, curl.
 *
 * This is a shared-secret gate, not per-user authorization. Anyone holding the
 * token has full access, so treat it like a password. If NEW_OPS_API_KEY is
 * unset the gate stays open, so existing deployments keep working until the
 * variable is configured.
 */
export function middleware(request) {
  const apiKey = process.env.NEW_OPS_API_KEY;

  // No key configured — behave exactly as before.
  if (!apiKey) return NextResponse.next();

  // The OpenAPI document stays public so an agent platform can discover the
  // available operations before it has been given a token. It describes the
  // shape of the API only — no records are exposed.
  if (request.nextUrl.pathname.endsWith('/openapi.json')) {
    return NextResponse.next();
  }

  // The auth routes authenticate themselves, so gating them behind the shared
  // secret would be backwards: nobody can sign in until they already hold the
  // key, which would make per-user sessions useless as a replacement for this
  // gate. They fail closed on their own — a wrong password is a 401 from the
  // route. Note there is no rate limiting on /auth/login yet.
  if (request.nextUrl.pathname.startsWith('/api/new/auth/')) {
    return NextResponse.next();
  }

  // Requests originating from our own pages.
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite === 'same-origin') return NextResponse.next();

  // Bearer token, or the x-api-key header for clients that can't set Authorization.
  const auth = request.headers.get('authorization') || '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null;
  const headerKey = request.headers.get('x-api-key');

  if (bearer === apiKey || headerKey === apiKey) return NextResponse.next();

  return NextResponse.json(
    {
      error: 'Unauthorized',
      message: 'Send the API key as "Authorization: Bearer <key>" or "x-api-key: <key>".',
    },
    { status: 401 }
  );
}

export const config = {
  matcher: '/api/new/:path*',
};
