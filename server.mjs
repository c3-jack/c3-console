import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readState(stateFile) {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(stateDir, stateFile, state) {
  fs.mkdirSync(stateDir, { recursive: true });
  const tmp = `${stateFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, stateFile);
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

function proxyCall({ baseUrl, authToken, authStyle, typeName, method, params }) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(`${baseUrl.replace(/\/+$/, '')}/api/8/${encodeURIComponent(typeName)}/${encodeURIComponent(method)}`);
    } catch (e) {
      return reject(new Error(`Invalid App URL: ${e.message}`));
    }

    const authHeader = authStyle === 'bearer' ? `Bearer ${authToken}` : `c3auth=${authToken}`;
    const payload = Buffer.from(JSON.stringify(params));

    const lib = target.protocol === 'http:' ? http : https;
    const req = lib.request(
      target,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
          'Content-Length': payload.length,
        },
        timeout: 30000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed;
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = text;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed, url: target.toString() });
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('Request timed out after 30s')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function fetchTypeNames({ baseUrl, authToken, authStyle }) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(`${baseUrl.replace(/\/+$/, '')}/typesys/8/names.json?includeInnerTypes`);
    } catch (e) {
      return reject(new Error(`Invalid App URL: ${e.message}`));
    }

    const authHeader = authStyle === 'bearer' ? `Bearer ${authToken}` : `c3auth=${authToken}`;
    const lib = target.protocol === 'http:' ? http : https;
    const req = lib.request(
      target,
      { method: 'GET', headers: { 'Authorization': authHeader }, timeout: 30000 },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed;
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = text;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('Request timed out after 30s')));
    req.on('error', reject);
    req.end();
  });
}

// Durable state (tabs, saved tokens, snippets) — a real file outside the Chrome/Electron
// profile, so it survives profile resets / "clear browsing data" / app updates. `stateDir`
// defaults to the same path the original standalone version always used, so an Electron host
// that passes `app.getPath('userData')` for an app named "c3-console" lands on the exact same
// directory and picks up existing saved state with zero migration.
export function startServer({ port = 4870, stateDir } = {}) {
  const STATE_DIR = stateDir || process.env.C3_CONSOLE_STATE_DIR || path.join(os.homedir(), 'Library', 'Application Support', 'c3-console');
  const STATE_FILE = path.join(STATE_DIR, 'state.json');

  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(html);
    }

    if (req.method === 'GET' && req.url === '/api/state') {
      return sendJson(res, 200, readState(STATE_FILE));
    }

    if (req.method === 'POST' && req.url === '/api/state') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        let state;
        try {
          state = JSON.parse(body);
        } catch {
          return sendJson(res, 400, { error: 'Malformed state body' });
        }
        try {
          writeState(STATE_DIR, STATE_FILE, state);
          return sendJson(res, 200, { ok: true });
        } catch (e) {
          return sendJson(res, 500, { error: e.message });
        }
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/types') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        let input;
        try {
          input = JSON.parse(body);
        } catch {
          return sendJson(res, 400, { error: 'Malformed request body' });
        }
        const { baseUrl, authToken, authStyle } = input;
        if (!baseUrl || !authToken) {
          return sendJson(res, 400, { error: 'App URL and Auth Token are required' });
        }
        try {
          const result = await fetchTypeNames({ baseUrl, authToken, authStyle });
          return sendJson(res, 200, result);
        } catch (e) {
          return sendJson(res, 502, { error: e.message });
        }
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/run') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        let input;
        try {
          input = JSON.parse(body);
        } catch {
          return sendJson(res, 400, { error: 'Malformed request body' });
        }
        const { baseUrl, authToken, authStyle, typeName, method, params } = input;
        if (!baseUrl || !authToken || !typeName || !method) {
          return sendJson(res, 400, { error: 'App URL, Auth Token, Type, and Function are all required' });
        }
        try {
          const result = await proxyCall({ baseUrl, authToken, authStyle, typeName, method, params });
          return sendJson(res, 200, result);
        } catch (e) {
          return sendJson(res, 502, { error: e.message });
        }
      });
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`c3-console server running at http://localhost:${port}`);
      resolve(server);
    });
  });
}

// Allow running standalone too: `node server.mjs` — same as the original script's behavior.
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer({ port: process.env.PORT ? Number(process.env.PORT) : 4870 });
}
