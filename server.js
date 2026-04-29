/**
 * Simple proxy server for the Schedule Integration Tool.
 * This server serves the local files AND proxies requests to Google Sheets,
 * bypassing the browser's CORS restriction when opening local files.
 *
 * HOW TO RUN: Double-click "Start Server.bat" in this folder.
 * Then open: http://localhost:3000
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 3000;

const MIME_TYPES = {
    '.html': 'text/html',
    '.css':  'text/css',
    '.js':   'text/javascript',
    '.json': 'application/json',
    '.png':  'image/png',
    '.ico':  'image/x-icon',
};

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    // ─── PROXY ENDPOINT ─────────────────────────────────────────────
    // The browser calls: GET /proxy?url=<encoded_google_url>
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
            // Follow one redirect if needed (Google redirects /pub to CDN)
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

    // ─── STATIC FILE SERVER ─────────────────────────────────────────
    let filePath = path.join(__dirname, url.pathname === '/' ? 'index.html' : url.pathname);
    if (url.pathname === '/admin') {
        filePath = path.join(__dirname, 'admin.html');
    }
    const ext = path.extname(filePath);

    if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('Not found');
        return;
    }

    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
    console.log('');
    console.log('  ✅  Schedule Tool Server is running!');
    console.log(`  🌐  Open this link in your browser: http://localhost:${PORT}`);
    console.log('');
    console.log('  Press Ctrl+C to stop the server.');
    console.log('');
});
