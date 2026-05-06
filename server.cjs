/**
 * Simple CORS proxy server for the Schedule Integration Tool (React version).
 * Runs on port 3001 — Vite dev server proxies /proxy requests here.
 *
 * HOW TO RUN: Use "npm start" to launch both Vite + this proxy.
 */

const http = require('http');
const https = require('https');

const PORT = 3001;

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    // ─── CORS headers for preflight ──────────────────────────────────
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // ─── PROXY ENDPOINT ─────────────────────────────────────────────
    if (url.pathname === '/proxy') {
        const target = url.searchParams.get('url');
        if (!target) {
            res.writeHead(400);
            res.end('Missing url parameter');
            return;
        }

        https.get(target, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Accept': 'text/csv,text/plain,*/*',
            }
        }, (proxyRes) => {
            // Follow one redirect if needed
            if ((proxyRes.statusCode === 301 || proxyRes.statusCode === 302 || proxyRes.statusCode === 307) && proxyRes.headers.location) {
                https.get(proxyRes.headers.location, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (finalRes) => {
                    res.writeHead(200, {
                        'Content-Type': 'text/plain; charset=utf-8',
                        'Access-Control-Allow-Origin': '*',
                    });
                    finalRes.pipe(res);
                }).on('error', (e) => { res.writeHead(500); res.end(e.message); });
            } else {
                res.writeHead(200, {
                    'Content-Type': 'text/plain; charset=utf-8',
                    'Access-Control-Allow-Origin': '*',
                });
                proxyRes.pipe(res);
            }
        }).on('error', (e) => {
            res.writeHead(500);
            res.end(`Proxy error: ${e.message}`);
        });
        return;
    }

    // Any other path → 404
    res.writeHead(404);
    res.end('Not found — this server only handles /proxy requests.');
});

server.listen(PORT, () => {
    console.log('');
    console.log('  ✅  CORS Proxy Server is running!');
    console.log(`  🌐  Proxy listening on: http://localhost:${PORT}/proxy`);
    console.log('');
});
