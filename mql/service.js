'use strict';
// MQL execution service. Listens on 127.0.0.1 only, requires X-Secret, and runs every job in a fresh
// sandboxed child: unprivileged user, no network (unshare -rn), rlimits (CPU/memory/files/no file writes), hard timeout.
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const PORT = +(process.env.MQL_PORT || 18090), SECRET = process.env.MQL_SECRET || '';
const MAX_BODY = 25e6, MAX_PAR = 3, MAX_QUEUE = 20, TIMEOUT_S = 12;
if (SECRET.length < 24) { console.error('MQL_SECRET (>=24 chars) is required'); process.exit(1); }

let running = 0; const queue = [];
function runJob(body) {
  const m = /^\{"timeoutS":(\d{1,2})[,}]/.exec(body.slice(0, 40)); const tmo = m ? Math.min(40, Math.max(5, +m[1])) : TIMEOUT_S; // strategy tests may need longer (hard-capped)
  return new Promise((resolve) => {
    const args = ['--as=3500000000', `--cpu=${tmo + 3}`, '--nofile=64', '--fsize=0', '--core=0', '--nproc=64', '--',
      'timeout', '-s', 'KILL', String(tmo), 'unshare', '-rn', process.execPath, '--max-old-space-size=300', path.join(__dirname, 'runner.js')];
    const ch = spawn('prlimit', args, { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin' } });
    let out = '', err = '', done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    ch.stdout.on('data', (c) => { out += c; if (out.length > 60e6) { ch.kill('SIGKILL'); finish({ ok: false, error: 'output too large' }); } });
    ch.stderr.on('data', (c) => { if (err.length < 2000) err += c; });
    ch.on('close', (code, sig) => {
      if (out) { try { return finish(JSON.parse(out)); } catch { /* fallthrough */ } }
      finish({ ok: false, error: sig === 'SIGKILL' || code === 137 ? 'terminated: time or memory limit exceeded' : `runner failed (code ${code}) ${err.trim().slice(0, 200)}`, kind: 'limit' });
    });
    ch.stdin.on('error', () => {}); ch.stdin.end(body);
  });
}
function schedule(body) {
  return new Promise((resolve) => {
    const go = () => { running++; runJob(body).then((r) => { running--; resolve(r); const next = queue.shift(); if (next) next(); }); };
    if (running < MAX_PAR) go(); else if (queue.length < MAX_QUEUE) queue.push(go); else resolve({ ok: false, error: 'server busy', kind: 'busy' });
  });
}

http.createServer((req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, running, queued: queue.length });
  if (req.method !== 'POST' || req.url !== '/run') return send(404, { error: 'not found' });
  if (req.headers['x-secret'] !== SECRET) return send(403, { error: 'forbidden' });
  let body = '', size = 0;
  req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { req.destroy(); return; } body += c; });
  req.on('end', async () => { if (size > MAX_BODY) return; send(200, await schedule(body)); });
}).listen(PORT, '127.0.0.1', () => console.log(`pmt-mql listening on 127.0.0.1:${PORT}`));
