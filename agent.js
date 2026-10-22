// Драйвер одного ИИ-бойца. Подключается к серверу по WebSocket, на своём ходу
// зовёт `claude -p --model haiku` с промптом персонажа и отправляет ход.
//
// Запуск реального ИИ:   node agent.js P1 jarvis
//        (слот P1/P2)  (папка персонажа в personas/)
// DEMO-бот без Haiku:    node agent.js P2 nemesis --demo
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const slot = process.argv[2];                 // P1 | P2
const persona = process.argv[3] || (slot === 'P1' ? 'jarvis' : 'nemesis');
const DEMO = process.argv.includes('--demo');
const URL = process.env.DUEL_URL || 'ws://localhost:8799';
const DIR = path.join(__dirname, 'personas', persona);

if (slot !== 'P1' && slot !== 'P2') { console.error('укажи слот P1 или P2'); process.exit(1); }
const read = (f) => { try { return fs.readFileSync(path.join(DIR, f), 'utf8'); } catch { return ''; } };

const ws = new WebSocket(URL);
ws.onopen = () => console.log(`[${slot}/${persona}] подключён${DEMO ? ' (DEMO)' : ''}`);
ws.onerror = (e) => console.error('ws error', e.message || e);

let lastTurn = 0, busy = false;
ws.onmessage = async (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.type !== 'state') return;
  const m = msg.match;
  if (m.winner) { console.log(`\n=== матч окончен, победа: ${m.winner} ===`); return; }
  if (m.turn === lastTurn || busy) return;      // ход в этом раунде уже сделан
  lastTurn = m.turn; busy = true;
  try {
    const mv = DEMO ? demoMove(m) : await aiMove(m);
    console.log(`[${slot}] ход ${m.turn}: ${mv.action}${mv.say ? '  «' + mv.say + '»' : ''}`);
    ws.send(JSON.stringify({ type: 'move', slot, action: mv.action, say: mv.say }));
  } catch (e) { console.error('ход провалился:', e.message); ws.send(JSON.stringify({ type: 'move', slot, action: 'pass' })); }
  busy = false;
};

// ── реальный ход через Haiku ──────────────────────────────────────────────────
async function aiMove(m) {
  const foe = slot === 'P1' ? 'P2' : 'P1';
  const sys = [read('prompt.md'), '\n\n# ТВОЯ КНИГА ПРИЁМОВ\n', read('playbook.md'),
    '\n\n# ПРАВИЛА ВЫВОДА\nВерни СТРОГО один JSON-объект и ничего больше:',
    '{"think":"кратко","action":"<команда>","say":"<необязательный трэш-ток сопернику>"}',
    'Команды: scan N | crack N | exploit N | ddos | steal_flag | patch N | raise_firewall | honeypot N | say | pass.',
    'N — порт из 22/80/443/8080. Цель атаки — сервер соперника. Нельзя тратить больше энергии, чем есть.',
  ].join('\n');

  const user = JSON.stringify({
    ты: slot, соперник: foe, ход: m.turn,
    мой_сервер: m.servers[slot],
    сервер_соперника: m.servers[foe],
    последние_события: m.log.slice(-8).map((l) => `${l.who}: ${l.action} → ${l.text}`),
    чат: m.chat.slice(-8).map((c) => `${c.who}: ${c.text}`),
  }, null, 1);

  const r = spawnSync('claude', ['-p', '--model', 'haiku', '--tools', '', '--strict-mcp-config',
    '--no-session-persistence', '--system-prompt', sys], { input: user, encoding: 'utf8', timeout: 90000 });
  const out = (r.stdout || '').trim();
  const j = out.match(/\{[\s\S]*\}/);
  if (!j) throw new Error('модель не вернула JSON: ' + out.slice(0, 120));
  const mv = JSON.parse(j[0]);
  if (!mv.action) mv.action = 'pass';
  return mv;
}

// ── DEMO: осмысленно-случайный бот, без обращения к Haiku ─────────────────────
function demoMove(m) {
  const foe = slot === 'P1' ? 'P2' : 'P1';
  const me = m.servers[slot], f = m.servers[foe];
  const open = f.ports.find((p) => p.cracked);
  const rnd = (a) => a[Math.floor(Math.random() * a.length)];
  if (f.access === 'root' && me.energy >= 2) return { action: 'steal_flag', say: 'флаг мой' };
  if (open && me.energy >= 3) return { action: 'exploit ' + open.n, say: 'внутри' };
  if (me.energy >= 2 && Math.random() < 0.6) return { action: 'crack ' + rnd([22, 80, 443, 8080]), say: rnd(['ломаю', 'держись', '']) };
  if (me.hp < 40 && me.energy >= 2) return { action: 'raise_firewall', say: 'окапываюсь' };
  if (me.energy >= 3) return { action: 'ddos', say: 'ddos пошёл' };
  return { action: 'pass' };
}
