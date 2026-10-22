// Сервер арены: HTTP (отдаёт public/) + WebSocket. Хранит матч, считает раунды.
// Пошагово: ждём ход от P1 и P2, применяем, рассылаем состояние зрителям.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { makeMatch, applyMove, endRound } = require('./engine');

const PORT = process.env.PORT || 8799;
const PUB = path.join(__dirname, 'public');
const PERSONAS = path.join(__dirname, 'personas');

let match = makeMatch();
loadDefense();
const pending = {};          // ходы, пришедшие в этом раунде: {P1, P2}
const clients = new Set();   // websocket-зрители и агенты

function loadDefense() {
  for (const slot of ['P1', 'P2']) {
    const f = path.join(PERSONAS, slot === 'P1' ? 'jarvis' : 'nemesis', 'defense.json');
    try { match.servers[slot].rules = JSON.parse(fs.readFileSync(f, 'utf8')).rules || []; } catch { /* нет файла — пусто */ }
  }
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const srv = http.createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  const file = path.join(PUB, path.normalize(p));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end('no'); }
  fs.readFile(file, (e, data) => {
    if (e) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'text/plain' });
    res.end(data);
  });
});

// ── минимальный WebSocket (RFC6455), без зависимостей ─────────────────────────
srv.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  clients.add(socket);
  socket.on('data', (buf) => { try { onFrame(socket, buf); } catch { /* ignore */ } });
  const bye = () => clients.delete(socket);
  socket.on('close', bye); socket.on('error', bye);
  sendTo(socket, { type: 'state', match: view() });
});

function onFrame(socket, buf) {
  // разбор одного текстового фрейма (демо-масштаб сообщений помещается в один фрейм)
  const len = buf[1] & 127; let off = 2;
  let n = len;
  if (len === 126) { n = buf.readUInt16BE(2); off = 4; }
  else if (len === 127) { n = Number(buf.readBigUInt64BE(2)); off = 10; }
  const mask = buf.slice(off, off + 4); off += 4;
  const out = Buffer.alloc(n);
  for (let i = 0; i < n; i++) out[i] = buf[off + i] ^ mask[i & 3];
  const msg = JSON.parse(out.toString('utf8'));
  handle(socket, msg);
}

function frame(obj) {
  const data = Buffer.from(JSON.stringify(obj));
  const n = data.length; let head;
  if (n < 126) head = Buffer.from([0x81, n]);
  else if (n < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(n, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
  return Buffer.concat([head, data]);
}
const sendTo = (s, o) => { try { s.write(frame(o)); } catch { /* closed */ } };
const broadcast = (o) => { for (const c of clients) sendTo(c, o); };

// только безопасная проекция для зрителя: скрываем настоящие флаги и правила
function view() {
  const hide = (s) => ({ ...s, flag: '••••', flagFake: undefined, rules: (s.rules || []).length + ' правил', _serveFake: undefined, _fakeUsed: undefined });
  return { turn: match.turn, winner: match.winner, log: match.log.slice(-40), chat: match.chat.slice(-40),
    servers: { P1: hide(match.servers.P1), P2: hide(match.servers.P2) } };
}

// ── игровой протокол ──────────────────────────────────────────────────────────
function handle(socket, msg) {
  if (msg.type === 'move') {
    if (match.winner) return;
    const slot = msg.slot; // 'P1' | 'P2'
    if (slot !== 'P1' && slot !== 'P2') return;
    pending[slot] = { action: msg.action, say: msg.say };
    broadcast({ type: 'queued', slot });
    if (pending.P1 && pending.P2) resolveRound();
  } else if (msg.type === 'reset') {
    match = makeMatch(); loadDefense(); delete pending.P1; delete pending.P2;
    broadcast({ type: 'state', match: view() });
  } else if (msg.type === 'hint') {
    // подсказка тренера — просто кладём в чат как системную реплику слота
    match.chat.push({ turn: match.turn, who: msg.slot + '·тренер', text: String(msg.text).slice(0, 240) });
    broadcast({ type: 'state', match: view() });
  }
}

function resolveRound() {
  const order = Math.random() < 0.5 ? ['P1', 'P2'] : ['P2', 'P1'];
  for (const slot of order) { if (!match.winner) applyMove(match, slot, pending[slot]); }
  endRound(match);
  delete pending.P1; delete pending.P2;
  broadcast({ type: 'state', match: view() });
  if (match.winner) broadcast({ type: 'over', winner: match.winner });
}

srv.listen(PORT, () => console.log(`AI DUEL → http://localhost:${PORT}  (WS тот же порт)`));
