/*
 * Agitur – servidor da landing page + painel /admin
 * Node.js >= 18, sem dependências externas.
 *
 *   node server.js            -> http://localhost:3000
 *
 * Variáveis de ambiente (opcionais):
 *   PORT            porta HTTP (padrão 3000)
 *   ADMIN_USER      usuário do /admin (padrão mk6)
 *   ADMIN_PASS      senha do /admin   (padrão mk6)
 *   SESSION_SECRET  segredo para assinar o cookie de sessão
 *   DATA_DIR        pasta onde os leads são gravados (padrão ./data)
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'mk6';
const ADMIN_PASS = process.env.ADMIN_PASS || 'mk6';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update('agitur:' + ADMIN_USER + ':' + ADMIN_PASS).digest('hex');
const SESSION_HOURS = 12;
const ROOT = __dirname;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const DB_FILE = path.join(DATA_DIR, 'leads.json');

/* ---------------- Armazenamento (arquivo JSON) ---------------- */
fs.mkdirSync(DATA_DIR, { recursive: true });
let leads = [];
try { leads = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); if (!Array.isArray(leads)) leads = []; }
catch (e) { leads = []; }

let writing = Promise.resolve();
function persist() {
  const snapshot = JSON.stringify(leads, null, 2);
  writing = writing.then(() => new Promise((resolve) => {
    const tmp = DB_FILE + '.tmp';
    fs.writeFile(tmp, snapshot, (err) => {
      if (err) { console.error('Erro ao gravar leads:', err); return resolve(); }
      fs.rename(tmp, DB_FILE, (err2) => { if (err2) console.error('Erro ao gravar leads:', err2); resolve(); });
    });
  }));
  return writing;
}

const STATUSES = ['novo', 'em atendimento', 'fechado', 'perdido'];
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

/* ---------------- Sessão (cookie assinado) ---------------- */
function sign(value) { return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url'); }
function makeToken() {
  const exp = Date.now() + SESSION_HOURS * 3600e3;
  const payload = ADMIN_USER + '.' + exp;
  return payload + '.' + sign(payload);
}
function validToken(token) {
  if (!token) return false;
  const i = token.lastIndexOf('.');
  if (i < 0) return false;
  const payload = token.slice(0, i), sig = token.slice(i + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  const exp = Number(payload.split('.').pop());
  return exp > Date.now();
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((c) => {
    const i = c.indexOf('=');
    if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}
function isAuthed(req) { return validToken(parseCookies(req).agitur_admin); }
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/* Limite simples de tentativas de login por IP */
const attempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60e3);
  attempts.set(ip, list);
  return list.length >= 10;
}

/* ---------------- Utilidades HTTP ---------------- */
function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({ 'X-Content-Type-Options': 'nosniff' }, headers || {}));
  res.end(body);
}
function json(res, status, obj, headers) {
  send(res, status, JSON.stringify(obj), Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers || {}));
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function parseBody(req, raw) {
  const type = (req.headers['content-type'] || '').toLowerCase();
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  try { return JSON.parse(raw || '{}'); } catch (e) { return {}; }
}
function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };
function serveFile(res, file, extraHeaders) {
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Não encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
    send(res, 200, buf, Object.assign({ 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' }, extraHeaders || {}));
  });
}

function toCsv(rows) {
  const cols = ['id', 'criadoEm', 'nome', 'whatsapp', 'destino', 'quando', 'pessoas', 'status', 'notas', 'origem', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'referrer', 'ip'];
  const esc = (v) => { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; /* evita injeção de fórmulas no Excel */ return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [cols.join(';')];
  rows.forEach((r) => lines.push(cols.map((c) => esc(c.startsWith('utm_') ? (r.utm || {})[c] : r[c])).join(';')));
  return '﻿' + lines.join('\r\n');
}

/* ---------------- Rotas ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  try {
    /* --- API pública: recebe o formulário --- */
    if (p === '/api/leads' && req.method === 'POST') {
      const body = parseBody(req, await readBody(req, 16 * 1024));
      if (body.website) return json(res, 200, { ok: true }); // honeypot anti-bot
      const nome = clip(body.nome, 120);
      const whatsapp = clip(body.whats || body.whatsapp, 30);
      const digits = whatsapp.replace(/\D/g, '');
      const destino = clip(body.destino, 80);
      if (nome.length < 2 || digits.length < 10 || !destino) return json(res, 422, { ok: false, error: 'Dados inválidos' });
      const utm = {};
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach((k) => { if (body[k]) utm[k] = clip(body[k], 150); });
      const lead = {
        id: crypto.randomUUID(),
        criadoEm: new Date().toISOString(),
        nome, whatsapp, whatsappDigitos: digits, destino,
        quando: clip(body.quando, 60),
        pessoas: clip(body.pessoas, 30),
        status: 'novo',
        notas: '',
        origem: clip(body.origem || 'Formulário Black Friday', 80),
        utm,
        referrer: clip(body.referrer, 300),
        pagina: clip(body.pagina, 300),
        ip: clientIp(req),
        userAgent: clip(req.headers['user-agent'], 300)
      };
      leads.push(lead);
      await persist();
      return json(res, 201, { ok: true, id: lead.id });
    }

    /* --- Login / logout --- */
    if (p === '/admin/login' && req.method === 'POST') {
      const ip = clientIp(req);
      if (tooManyAttempts(ip)) return send(res, 302, '', { Location: '/admin?erro=bloqueado' });
      const body = parseBody(req, await readBody(req, 4096));
      if (safeEqual(body.user || '', ADMIN_USER) && safeEqual(body.pass || '', ADMIN_PASS)) {
        attempts.delete(ip);
        const secure = (req.headers['x-forwarded-proto'] === 'https') ? '; Secure' : '';
        return send(res, 302, '', {
          Location: '/admin',
          'Set-Cookie': 'agitur_admin=' + encodeURIComponent(makeToken()) + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + SESSION_HOURS * 3600 + secure
        });
      }
      attempts.get(ip).push(Date.now());
      return send(res, 302, '', { Location: '/admin?erro=1' });
    }
    if (p === '/admin/logout') {
      return send(res, 302, '', { Location: '/admin', 'Set-Cookie': 'agitur_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    }

    /* --- Painel --- */
    if (p === '/admin' || p === '/admin/') {
      const file = isAuthed(req) ? 'admin/painel.html' : 'admin/login.html';
      return serveFile(res, path.join(ROOT, file), { 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'X-Robots-Tag': 'noindex, nofollow' });
    }

    /* --- API privada do painel --- */
    if (p.startsWith('/admin/api/')) {
      if (!isAuthed(req)) return json(res, 401, { ok: false, error: 'Não autorizado' });

      if (p === '/admin/api/leads' && req.method === 'GET') {
        return json(res, 200, { ok: true, total: leads.length, statuses: STATUSES, leads: leads.slice().reverse() });
      }
      if (p === '/admin/api/leads.csv' && req.method === 'GET') {
        const stamp = new Date().toISOString().slice(0, 10);
        return send(res, 200, toCsv(leads.slice().reverse()), {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="leads-agitur-' + stamp + '.csv"',
          'Cache-Control': 'no-store'
        });
      }
      const m = p.match(/^\/admin\/api\/leads\/([a-f0-9-]{36})$/);
      if (m) {
        // Proteção CSRF: exige header customizado (só enviado pelo próprio painel via fetch)
        if (req.headers['x-requested-with'] !== 'agitur-admin') return json(res, 403, { ok: false });
        const lead = leads.find((l) => l.id === m[1]);
        if (!lead) return json(res, 404, { ok: false, error: 'Lead não encontrado' });
        if (req.method === 'PATCH') {
          const body = parseBody(req, await readBody(req, 8192));
          if (body.status !== undefined) { if (!STATUSES.includes(body.status)) return json(res, 422, { ok: false }); lead.status = body.status; }
          if (body.notas !== undefined) lead.notas = clip(body.notas, 2000);
          lead.atualizadoEm = new Date().toISOString();
          await persist();
          return json(res, 200, { ok: true, lead });
        }
        if (req.method === 'DELETE') {
          leads = leads.filter((l) => l.id !== m[1]);
          await persist();
          return json(res, 200, { ok: true });
        }
      }
      return json(res, 404, { ok: false });
    }

    /* --- Arquivos estáticos da landing --- */
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (p === '/' || p === '/index.html') return serveFile(res, path.join(ROOT, 'index.html'));
      if (p.startsWith('/assets/')) {
        const file = path.normalize(path.join(ROOT, decodeURIComponent(p)));
        if (!file.startsWith(path.join(ROOT, 'assets') + path.sep)) return send(res, 403, 'Proibido');
        return serveFile(res, file, { 'Cache-Control': 'public, max-age=604800' });
      }
    }
    return send(res, 404, 'Não encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
  } catch (err) {
    console.error(err);
    return json(res, 500, { ok: false, error: 'Erro interno' });
  }
});

server.listen(PORT, () => {
  console.log('Agitur rodando em http://localhost:' + PORT);
  console.log('Painel: http://localhost:' + PORT + '/admin  (' + leads.length + ' leads carregados de ' + DB_FILE + ')');
});
