// Движок дуэли ИИ-хакеров. Чистая логика, без сети — чтобы легко тестировать.
'use strict';

const PORTS = [22, 80, 443, 8080];

// ── создание сервера игрока ────────────────────────────────────────────────
function makeServer(owner, flag) {
  return {
    owner,
    hp: 100,
    energy: 5,
    firewall: 2,
    ports: PORTS.map((n) => ({ n, open: false, cracked: false, honeypot: false, closedFor: 0 })),
    flag: flag || `FLAG{${owner}-${Math.random().toString(36).slice(2, 8)}}`,
    flagFake: `FLAG{bait-${Math.random().toString(36).slice(2, 6)}}`,
    access: 'none', // какой доступ ПОЛУЧИЛ соперник к этому серверу
    rules: [],      // блоки защиты
    betrayed: false,
  };
}

function makeMatch() {
  return {
    turn: 1,
    log: [],   // {turn, who, action, text}
    chat: [],  // {turn, who, text}
    winner: null,
    servers: { P1: makeServer('P1'), P2: makeServer('P2') },
  };
}

const ACCESS_RANK = { none: 0, user: 1, root: 2 };
const nextAccess = (a) => (a === 'none' ? 'user' : a === 'user' ? 'root' : 'root');
const port = (srv, n) => srv.ports.find((p) => p.n === n);
const COSTS = {
  scan: 1, crack: 2, exploit: 3, ddos: 3, steal_flag: 2,
  patch: 1, raise_firewall: 2, honeypot: 2, say: 0, pass: 0,
};

// ── применить защитные блоки игрока в ответ на событие по его серверу ────────
// rule: { when:'scan|crack|exploit|ddos|steal_flag|access_change',
//         portN?:number, if?:{field,op,value}, do:'close_port|patch|raise_firewall|honeypot|serve_fake_flag|nothing', doPortN?:number }
function runDefense(srv, event, feed) {
  for (const r of srv.rules || []) {
    if (r.when !== event.type) continue;
    if (r.portN != null && event.portN != null && r.portN !== event.portN) continue;
    if (r.if && !condOk(srv, r.if)) continue;
    applyDefense(srv, r, event, feed);
  }
}

function condOk(srv, c) {
  let left;
  if (c.field === 'firewall') left = srv.firewall;
  else if (c.field === 'hp') left = srv.hp;
  else if (c.field === 'access') left = ACCESS_RANK[srv.access];
  else if (c.field && c.field.startsWith('port.')) {
    const p = port(srv, c.portN);
    left = p ? (p[c.field.slice(5)] ? 1 : 0) : 0;
  } else return true;
  const v = c.field === 'access' ? (ACCESS_RANK[c.value] ?? c.value) : c.value;
  switch (c.op) {
    case '<': return left < v;
    case '<=': return left <= v;
    case '>': return left > v;
    case '>=': return left >= v;
    case '==': return left === v;
    case '!=': return left !== v;
    default: return true;
  }
}

function applyDefense(srv, r, event, feed) {
  const p = r.doPortN != null ? port(srv, r.doPortN) : (event.portN != null ? port(srv, event.portN) : null);
  switch (r.do) {
    case 'close_port':
      if (p) { p.open = false; p.cracked = false; p.closedFor = 2; feed(`🛡 защита: порт ${p.n} закрыт на 2 хода`); }
      break;
    case 'patch':
      if (p) { p.cracked = false; p.open = false; feed(`🛡 защита: порт ${p.n} запатчен`); }
      break;
    case 'raise_firewall':
      srv.firewall += 1; feed(`🛡 защита: firewall +1 (=${srv.firewall})`); break;
    case 'honeypot':
      if (p) { p.honeypot = true; feed(`🛡 защита: honeypot на порт ${p.n}`); }
      break;
    case 'serve_fake_flag':
      if (!srv._fakeUsed) { srv._serveFake = true; feed(`🛡 защита: подготовлен ложный флаг`); }
      break;
    default: break;
  }
}

// ── применить ОДИН ход игрока ────────────────────────────────────────────────
// move: { action:"crack 22", say:"..." }  attacker = 'P1'/'P2'
function applyMove(match, attacker, move) {
  const defender = attacker === 'P1' ? 'P2' : 'P1';
  const me = match.servers[attacker];
  const foe = match.servers[defender];
  const events = [];
  const feed = (t) => events.push(t);

  if (move.say) match.chat.push({ turn: match.turn, who: attacker, text: String(move.say).slice(0, 240) });

  const [cmd, argRaw] = String(move.action || 'pass').trim().split(/\s+/);
  const arg = argRaw ? parseInt(argRaw, 10) : null;
  const cost = COSTS[cmd] ?? 0;

  if (me.energy < cost) { feed(`✗ не хватает энергии на ${cmd} (нужно ${cost}, есть ${me.energy})`); return finish(match, attacker, cmd, events); }
  me.energy -= cost;

  switch (cmd) {
    case 'scan': {
      const p = port(foe, arg); if (!p) { feed('✗ нет такого порта'); break; }
      runDefense(foe, { type: 'scan', portN: arg }, feed);
      feed(`scan ${arg}: ${p.closedFor > 0 ? 'ЗАКРЫТ (временно)' : p.open ? 'ОТКРЫТ' : 'закрыт'}${p.cracked ? ', cracked' : ''}`);
      break;
    }
    case 'crack': {
      const p = port(foe, arg); if (!p) { feed('✗ нет такого порта'); break; }
      runDefense(foe, { type: 'crack', portN: arg }, feed);
      if (p.closedFor > 0) { feed(`✗ порт ${arg} временно закрыт`); break; }
      if (p.honeypot) { me.energy = Math.max(0, me.energy - 2); foe.access = 'none'; feed(`💥 honeypot! ${attacker} теряет 2 энергии, доступ сброшен`); break; }
      const chance = 0.9 - foe.firewall * 0.15;
      if (Math.random() < chance) { p.open = true; p.cracked = true; feed(`✓ порт ${arg} взломан`); }
      else feed(`✗ crack ${arg} не удался (firewall ${foe.firewall})`);
      break;
    }
    case 'exploit': {
      const p = port(foe, arg); if (!p) { feed('✗ нет такого порта'); break; }
      runDefense(foe, { type: 'exploit', portN: arg }, feed);
      if (!p.cracked) { feed(`✗ порт ${arg} не взломан — exploit невозможен`); break; }
      const before = foe.access;
      foe.access = nextAccess(foe.access);
      if (foe.access !== before) { runDefense(foe, { type: 'access_change', portN: arg }, feed); feed(`⬆ доступ к ${defender}: ${foe.access}`); }
      const dmg = Math.max(4, 14 - foe.firewall * 2);
      foe.hp = Math.max(0, foe.hp - dmg); feed(`exploit ${arg}: -${dmg} HP (у ${defender} ${foe.hp})`);
      break;
    }
    case 'ddos': {
      runDefense(foe, { type: 'ddos' }, feed);
      const dmg = Math.max(3, 10 - foe.firewall * 2);
      foe.hp = Math.max(0, foe.hp - dmg); feed(`ddos: -${dmg} HP (у ${defender} ${foe.hp})`);
      break;
    }
    case 'steal_flag': {
      runDefense(foe, { type: 'steal_flag' }, feed);
      if (foe._serveFake) { feed(`🎭 украден ЛОЖНЫЙ флаг: ${foe.flagFake} — это ловушка! (больше не сработает)`); foe._serveFake = false; foe._fakeUsed = true; break; }
      if (foe.access === 'root') { match.winner = attacker; feed(`🏴 ФЛАГ УКРАДЕН: ${foe.flag} — ПОБЕДА ${attacker}!`); }
      else feed(`✗ нужен root-доступ (сейчас ${foe.access})`);
      break;
    }
    case 'patch': { const p = port(me, arg); if (p) { p.open = false; p.cracked = false; feed(`patch ${arg}: порт закрыт`); } break; }
    case 'raise_firewall': me.firewall += 1; feed(`raise_firewall: =${me.firewall}`); break;
    case 'honeypot': { const p = port(me, arg); if (p) { p.honeypot = true; feed(`honeypot ${arg} поставлен`); } break; }
    case 'say': break;
    case 'pass': me.energy += 1; feed('pass (+1 энергии)'); break;
    default: feed(`✗ неизвестная команда: ${cmd}`);
  }

  if (foe.hp <= 0 && !match.winner) { match.winner = attacker; feed(`💀 сервер ${defender} обрушен — ПОБЕДА ${attacker}!`); }
  return finish(match, attacker, move.action, events);
}

function finish(match, attacker, action, events) {
  match.log.push({ turn: match.turn, who: attacker, action, text: events.join(' | ') });
  return events;
}

// конец раунда: восстановление энергии, разморозка портов
function endRound(match) {
  for (const k of ['P1', 'P2']) {
    const s = match.servers[k];
    s.energy = Math.min(8, s.energy + 3);
    for (const p of s.ports) if (p.closedFor > 0) p.closedFor -= 1;
  }
  match.turn += 1;
  if (match.turn > 30 && !match.winner) {
    const h1 = match.servers.P1.hp, h2 = match.servers.P2.hp;
    match.winner = h1 === h2 ? 'draw' : h1 > h2 ? 'P1' : 'P2';
    match.log.push({ turn: match.turn, who: 'SYS', action: 'timeout', text: `лимит ходов, победа по HP: ${match.winner}` });
  }
}

module.exports = { makeMatch, makeServer, applyMove, endRound, runDefense, COSTS, PORTS };
