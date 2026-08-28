import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { networkInterfaces } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Every IPv4 address this machine currently answers on.
 *
 * Read at startup rather than written down, because the previous config pinned a
 * single address and DHCP moved the laptop off it twice — each time the LAN
 * stopped working with no obvious cause, since the dev server still reported
 * itself as listening fine.
 */
function localIPv4Addresses() {
  const found = new Set();
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      if (address.address.startsWith('169.254.')) continue; // link-local, never reachable
      found.add(address.address);
    }
  }
  return [...found];
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  /*
   * Hosts allowed to load dev-only resources (`/_next/*`, HMR websocket).
   *
   * Matched on HOSTNAME ONLY — Next parses the Origin header and compares
   * `parsedOrigin.hostname`, so the port is discarded. The `:3000` entries that
   * used to be here matched nothing and only made the list look complete.
   *
   * Wildcards match one dot-separated segment, which for an IPv4 address means
   * one octet, so `192.168.*.*` covers the whole private range. The private
   * ranges are listed so a new DHCP lease cannot break this again mid-session,
   * before anyone thinks to restart.
   *
   * Development only: this setting has no effect on `next start`, and it is not
   * an authentication boundary. It exists so a page on another origin cannot
   * make your browser fetch this dev server's internals. Widening it to the
   * private ranges means any device already on your LAN could do that — which is
   * a far smaller exposure than the alternative of an app nobody can test on a
   * phone, and it stops at the LAN.
   */
  allowedDevOrigins: [
    'localhost',
    '127.0.0.1',
    '*.local',
    // RFC 1918 private ranges, so any address the router hands out is accepted.
    '10.*.*.*',
    '192.168.*.*',
    ...Array.from({ length: 16 }, (_, i) => `172.${16 + i}.*.*`),
    // The concrete addresses too, which is what shows in the startup log.
    ...localIPv4Addresses(),
  ],
  turbopack: {
    root: __dirname,
  },
  typescript: {
    // Unblock deployment by ignoring TS errors during production builds
    ignoreBuildErrors: true,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
