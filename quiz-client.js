const $ = id => document.getElementById(id);
let roomCode = '', playerId = '', source = null, lastIndex = -1, locked = false;
const icons = ['🦊', '🐸', '🐼', '🐙', '🐯', '🐨', '🐧', '🦉'];

function show(which) {
  ['lobby', 'game', 'results'].forEach(id => $(id).classList.toggle('hidden', id !== which));
}
async function api(path, data) {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Не удалось выполнить запрос');
  return result;
}
function notice(message) { $('notice').textContent = message; }
async function enter(create) {
  try {
    const name = $('nameInput').value.trim();
    if (!name) throw new Error('Введи имя, чтобы продолжить.');
    const result = await api(create ? '/api/create' : '/api/join', create ? { name } : { name, code: $('codeInput').value });
    roomCode = result.code; playerId = result.playerId;
    history.replaceState({}, '', `?room=${roomCode}`);
    $('entry').classList.add('hidden'); $('roomArea').classList.remove('hidden'); $('roomcode').textContent = roomCode;
    connect();
  } catch (error) { notice(error.message); }
}
function connect() {
  source?.close(); source = new EventSource(`/events?room=${roomCode}`);
  source.onopen = () => $('connection').textContent = 'Сервер подключён';
  source.onerror = () => $('connection').textContent = 'Переподключаемся…';
  source.addEventListener('state', event => render(JSON.parse(event.data)));
}
function render(state) {
  const me = state.players.find(player => player.id === playerId);
  $('players').innerHTML = state.players.map((player, i) => `<div class="player"><div class="avatar">${icons[i % icons.length]}</div>${escapeHtml(player.name)}${player.id === state.hostId ? '<span class="host">ВЕДУЩИЙ</span>' : ''}</div>`).join('');
  $('count').textContent = `${state.players.length} из 8 присоединились`;
  $('start').classList.toggle('hidden', playerId !== state.hostId || state.phase !== 'lobby');
  $('roomHint').textContent = playerId === state.hostId ? 'Поделись кодом комнаты с друзьями.' : 'Ожидаем начала игры…';
  if (state.phase === 'lobby') { show('lobby'); return; }
  if (state.phase === 'finished') { renderResults(state); show('results'); return; }
  show('game'); $('round').textContent = `ВОПРОС ${state.index + 1} ИЗ ${state.total}`;
  $('seconds').textContent = state.secondsLeft; $('fill').style.transform = `scaleX(${state.secondsLeft / 15})`;
  $('gamePlayers').textContent = `Игроков в комнате: ${state.players.length}`;
  if (!state.question) return;
  if (lastIndex !== state.index) {
    lastIndex = state.index; locked = false; $('feedback').textContent = ''; $('question').textContent = state.question.q; $('answers').innerHTML = '';
    state.question.a.forEach((answer, i) => { const button = document.createElement('button'); button.className = 'answer'; button.textContent = answer; button.onclick = () => sendAnswer(i); $('answers').appendChild(button); });
  }
  $('myScore').textContent = me ? me.score : 0;
  const answers = [...document.querySelectorAll('.answer')];
  if (me?.answered && state.phase === 'question') { locked = true; $('feedback').textContent = 'Ответ принят. Ждём остальных…'; answers.forEach(button => button.disabled = true); }
  if (state.phase === 'reveal') {
    locked = true; answers.forEach((button, i) => { button.disabled = true; if (i === state.correct) button.classList.add('correct'); });
    $('feedback').textContent = me?.answered ? 'Ответ раскрыт — готовься к следующему!' : 'Время вышло!';
  }
}
async function sendAnswer(choice) {
  if (locked) return; locked = true; document.querySelectorAll('.answer').forEach(button => button.disabled = true);
  try { await api('/api/answer', { code: roomCode, playerId, choice }); }
  catch (error) { $('feedback').textContent = error.message; }
}
function renderResults(state) {
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  $('winner').textContent = sorted.length ? `${sorted[0].name} победил!` : 'Игра завершена';
  $('leaders').innerHTML = sorted.map((player, i) => `<div class="leader"><span class="rank">${String(i + 1).padStart(2, '0')}</span><div class="avatar">${icons[i % icons.length]}</div><strong>${escapeHtml(player.name)}</strong><span class="points">${player.score.toLocaleString('ru-RU')} <span class="pts">очков</span></span></div>`).join('');
}
function escapeHtml(value) { return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }

$('create').onclick = () => enter(true);
$('join').onclick = () => enter(false);
$('start').onclick = async () => { try { await api('/api/start', { code: roomCode, playerId }); } catch (error) { $('roomHint').textContent = error.message; } };
$('copy').onclick = async () => {
  const invite = `${location.origin}${location.pathname}?room=${roomCode}`;
  try { await navigator.clipboard.writeText(invite); $('copied').textContent = 'Ссылка скопирована — отправь её друзьям.'; }
  catch { $('copied').textContent = `Код для друзей: ${roomCode}`; }
};
$('again').onclick = () => { source?.close(); history.replaceState({}, '', '/'); location.reload(); };
$('codeInput').value = new URLSearchParams(location.search).get('room') || '';
