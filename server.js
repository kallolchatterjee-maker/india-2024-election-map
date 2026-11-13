/**
 * The Majority That Slipped Away — Node.js static file server
 *
 * Serves the India 2024 Lok Sabha scrollytelling map over HTTP so that
 * fetch() can load the GeoJSON and CSV data files.
 *
 * Usage:
   node server.js
   # then open http://localhost:8080/Index.html
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { join, extname, parse } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = parse(fileURLToPath(import.meta.url)).dir;
const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || 'localhost';

const MIME_TYPES = {
  '.html':    'text/html; charset=utf-8',
  '.css':     'text/css; charset=utf-8',
  '.js':      'application/javascript; charset=utf-8',
  '.json':    'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.csv':     'text/csv; charset=utf-8',
  '.png':     'image/png',
  '.jpg':     'image/jpeg',
  '.svg':     'image/svg+xml',
  '.ico':     'image/x-icon',
};

function tryPort(port) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      let urlPath = req.url || '/';

      // Root -> serve Index.html
      if (urlPath === '/' || urlPath === '/index.html') {
        urlPath = '/Index.html';
      }

      const filePath = join(__dirname, urlPath);
      const ext = extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      createReadStream(filePath)
        .on('open', () => {
          res.writeHead(200, { 'Content-Type': contentType });
        })
        .on('error', (err) => {
          if (err.code === 'ENOENT') {
            // Fallback to Index.html for SPA-style routing
            createReadStream(join(__dirname, 'Index.html'))
              .on('open', () => {
                res.writeHead(200, { 'Content-Type': MIME_TYPES['.html'] });
              })
              .pipe(res);
          } else {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end(`Server error: ${err.message}`);
          }
        })
        .pipe(res);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve({ port, inUse: true });
      } else {
        reject(err);
      }
    });

    server.listen(port, HOST, () => {
      resolve({ server, port, inUse: false });
    });
  });
}

async function start() {
  let port = PORT;
  const maxAttempts = 10;

  for (let i = 0; i < maxAttempts; i++) {
    const result = await tryPort(port);

    if (result.inUse) {
      console.log(`Port ${port} is in use, trying ${port + 1}...`);
      port++;
      continue;
    }

    const { server } = result;
    console.log(`Server running at http://${HOST}:${port}/`);
    console.log(`Open: http://${HOST}:${port}/Index.html`);
    return;
  }

  console.error(`Could not find an available port after ${maxAttempts} attempts.`);
  process.exit(1);
}

start().catch((err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
