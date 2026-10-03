const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const PAGE = path.join(__dirname, 'quiz-room.html');
const questions = [
  { q: 'Какая планета Солнечной системы самая большая?', a: ['Земля', 'Юпитер', 'Сатурн', 'Нептун'], c: 1 },
  { q: 'Сколько цветов в классической радуге?', a: ['5', '6', '7', '8'], c: 2 },
  { q: 'Какой океан самый большой на Земле?', a: ['Атлантический', 'Индийский', 'Северный Ледовитый', 'Тихий'], c: 3 },
  { q: 'Кто написал роман «Мастер и Маргарита»?', a: ['Антон Чехов', 'Михаил Булгаков', 'Лев Толстой', 'Иван Тургенев'], c: 1 },
  { q: 'Как называется столица Австралии?', a: ['Сидней', 'Мельбурн', 'Канберра', 'Перт'], c: 2 },
];
const rooms = new Map();

function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(data));
}
function publicRoom(room) {
  const q = room.phase === 'question' || room.phase === 'reveal' ? questions[room.index] : null;
  return {
    code: room.code, phase: room.phase, hostId: room.hostId,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, score: p.score, answered: p.answered })),
    index: room.index, total: questions.length,
    question: q ? { q: q.q, a: q.a } : null,
    correct: room.phase === 'reveal' && q ? q.c : null,
    secondsLeft: room.phase === 'question' ? Math.max(0, Math.ceil((room.deadline - Date.now()) / 1000)) : 0,
  };
}
function broadcast(room) {
  const packet = `event: state\ndata: ${JSON.stringify(publicRoom(room))}\n\n`;
  for (const client of room.clients) client.write(packet);
}
function endQuestion(room) {
  if (room.phase !== 'question') return;
  room.phase = 'reveal'; clearInterval(room.clock);
  broadcast(room);
  setTimeout(() => {
    if (room.phase !== 'reveal') return;
    if (room.index + 1 >= questions.length) { room.phase = 'finished'; broadcast(room); return; }
    room.index++; room.phase = 'question'; room.deadline = Date.now() + 15000;
    room.players.forEach(p => { p.answered = false; });
    room.clock = setInterval(() => {
      if (Date.now() >= room.deadline) endQuestion(room);
      else broadcast(room);
    }, 1000);
    broadcast(room);
  }, 1800);
}
function startRoom(room) {
  if (room.phase !== 'lobby' || room.players.size < 2) return false;
  room.phase = 'question'; room.index = 0; room.deadline = Date.now() + 15000;
  room.players.forEach(p => { p.score = 0; p.answered = false; });
  room.clock = setInterval(() => {
    if (Date.now() >= room.deadline) endQuestion(room);
    else broadcast(room);
  }, 1000);
  broadcast(room); return true;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''; req.on('data', chunk => { body += chunk; if (body.length > 10000) reject(new Error('Too much data')); });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('Invalid JSON')); } });
  });
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' }); return res.end(); }
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/quiz-room.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return fs.createReadStream(PAGE).pipe(res);
  }
  if (req.method === 'GET' && url.pathname === '/quiz-client.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
    return fs.createReadStream(path.join(__dirname, 'quiz-client.js')).pipe(res);
  }
  if (req.method === 'GET' && url.pathname === '/events') {
    const room = rooms.get((url.searchParams.get('room') || '').toUpperCase());
    if (!room) return json(res, 404, { error: 'Комната не найдена' });
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive', 'access-control-allow-origin': '*' });
    res.write(`event: state\ndata: ${JSON.stringify(publicRoom(room))}\n\n`);
    room.clients.add(res); req.on('close', () => room.clients.delete(res)); return;
  }
  if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
    let data; try { data = await readBody(req); } catch (e) { return json(res, 400, { error: e.message }); }
    if (url.pathname === '/api/create') {
      const name = String(data.name || '').trim().slice(0, 20); if (!name) return json(res, 400, { error: 'Введите имя' });
      let code; do { code = crypto.randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(code));
      const id = crypto.randomUUID(); const room = { code, phase: 'lobby', hostId: id, players: new Map(), clients: new Set(), index: 0 };
      room.players.set(id, { id, name, score: 0, answered: false }); rooms.set(code, room);
      return json(res, 200, { code, playerId: id });
    }
    if (url.pathname === '/api/join') {
      const code = String(data.code || '').trim().toUpperCase(); const room = rooms.get(code); const name = String(data.name || '').trim().slice(0, 20);
      if (!room) return json(res, 404, { error: 'Комната не найдена' });
      if (!name) return json(res, 400, { error: 'Введите имя' });
      if (room.phase !== 'lobby') return json(res, 409, { error: 'Игра уже началась' });
      if (room.players.size >= 8) return json(res, 409, { error: 'В комнате уже 8 игроков' });
      const id = crypto.randomUUID(); room.players.set(id, { id, name, score: 0, answered: false }); broadcast(room);
      return json(res, 200, { code, playerId: id });
    }
    const code = String(data.code || '').toUpperCase(); const room = rooms.get(code); if (!room) return json(res, 404, { error: 'Комната не найдена' });
    if (url.pathname === '/api/start') {
      if (data.playerId !== room.hostId) return json(res, 403, { error: 'Начать игру может ведущий' });
      if (!startRoom(room)) return json(res, 409, { error: 'Нужно минимум два игрока' });
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/answer') {
      const player = room.players.get(data.playerId);
      if (!player) return json(res, 403, { error: 'Игрок не найден' });
      if (room.phase !== 'question' || player.answered) return json(res, 409, { error: 'Ответ уже принят или время вышло' });
      const choice = Number(data.choice); if (!Number.isInteger(choice) || choice < 0 || choice > 3) return json(res, 400, { error: 'Неверный вариант ответа' });
      player.answered = true;
      if (choice === questions[room.index].c) player.score += 500 + Math.max(0, Math.floor((room.deadline - Date.now()) / 1000)) * 20;
      broadcast(room);
      if ([...room.players.values()].every(p => p.answered)) endQuestion(room);
      return json(res, 200, { ok: true });
    }
  }
  json(res, 404, { error: 'Не найдено' });
});
server.listen(PORT, '0.0.0.0', () => console.log(`Quiz server running at http://localhost:${PORT}`));
