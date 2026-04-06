// U-MAt(hematics) — Client Logic
const socket = io();
let currentRoomId = null;
let isHost = false;
let myId = null;
let canvas = null;
let timerInterval = null;

// ── Toast System ───────────────────────────────────────────────────────────────
function toast(message, type = 'info') {
    const icons = { success: '✓', error: '✗', info: 'ℹ', warning: '⚠' };
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ'}</span><span class="toast-message">${message}</span>`;
    container.appendChild(el);
    setTimeout(() => { el.classList.add('toast-exit'); setTimeout(() => el.remove(), 300); }, 3500);
}

// ── DOM Helpers ────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function showScreen(screen) {
    $('lobby').style.display = screen === 'lobby' ? 'block' : 'none';
    $('game-container').style.display = screen === 'game' ? 'flex' : 'none';
}

// ── Lobby Actions ──────────────────────────────────────────────────────────────
function createRoom() {
    const name = $('username').value.trim();
    if (!name) { toast('Lütfen bir isim girin!', 'warning'); return; }
    socket.emit('createRoom', name);
}

function joinRoom() {
    const name = $('username').value.trim();
    const code = $('roomIdInput').value.trim();
    if (!name) { toast('Lütfen bir isim girin!', 'warning'); return; }
    if (!code) { toast('Lütfen oda kodunu girin!', 'warning'); return; }
    socket.emit('joinRoom', { roomId: code, username: name });
}

function startGame() {
    if (currentRoomId) socket.emit('startGame', currentRoomId);
}

// ── Canvas Setup ───────────────────────────────────────────────────────────────
function initCanvas() {
    const wrapper = document.querySelector('.canvas-wrapper');
    const w = wrapper.clientWidth || 600;
    canvas = new fabric.Canvas('solver-canvas', { isDrawingMode: true, width: w, height: 300 });
    canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
    canvas.freeDrawingBrush.width = 2;
    canvas.freeDrawingBrush.color = '#000';
    canvas.backgroundColor = '#fff';
    canvas.renderAll();
}

function clearCanvas() { if (canvas) { canvas.clear(); canvas.backgroundColor = '#fff'; canvas.renderAll(); } }

function onColorChange(e) { if (canvas) canvas.freeDrawingBrush.color = e.target.value; }
function onBrushSize(e) { if (canvas) canvas.freeDrawingBrush.width = parseInt(e.target.value, 10); }
function toggleEraser() {
    if (!canvas) return;
    const isEraser = canvas.freeDrawingBrush.color === '#ffffff';
    canvas.freeDrawingBrush.color = isEraser ? ($('draw-color').value || '#000') : '#ffffff';
    canvas.freeDrawingBrush.width = isEraser ? 2 : 20;
    toast(isEraser ? 'Kalem modu' : 'Silgi modu', 'info');
}

// ── HP Color ───────────────────────────────────────────────────────────────────
function hpColor(hp) {
    const pct = Math.max(0, hp) / 200;
    if (pct > 0.5) return 'var(--hp-high)';
    if (pct > 0.25) return 'var(--hp-mid)';
    return 'var(--hp-low)';
}

// ── Render Players ─────────────────────────────────────────────────────────────
function renderPlayers(state) {
    const grid = $('players-grid');
    grid.innerHTML = '';
    state.players.forEach(p => {
        const pct = Math.max(0, (p.hp / 200) * 100);
        const isTurn = p.id === state.currentPlayerId;
        const cls = ['player-card', 'glass-panel', isTurn ? 'is-turn' : '', p.hp <= 0 ? 'is-dead' : '', !p.isConnected ? 'is-disconnected' : ''].filter(Boolean).join(' ');
        const hostBadge = p.id === state.host ? '<span class="host-badge">Host</span>' : '';
        grid.innerHTML += `<div class="${cls}">
            <div class="player-name">${esc(p.username)}${hostBadge}</div>
            <div class="player-meta">${p.cardCount} kart</div>
            <div class="hp-bar-container"><div class="hp-bar" style="width:${pct}%;background:${hpColor(p.hp)}"></div></div>
            <div class="hp-text">HP: ${Math.max(0, p.hp)} / 200</div>
        </div>`;
    });
}

// ── Render Hand ────────────────────────────────────────────────────────────────
function renderHand(hand, isMyTurn) {
    const container = $('hand-cards');
    container.innerHTML = '';
    if (!hand || hand.length === 0) { container.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem">El boş</p>'; return; }
    hand.forEach(card => {
        const disabled = !isMyTurn;
        const typeColors = { normal: 'var(--accent)', skip: 'var(--warning)', reverse: '#a855f7', draw2: 'var(--incorrect)' };
        const div = document.createElement('div');
        div.className = `hand-card glass-panel${disabled ? ' disabled' : ''}`;
        div.innerHTML = `
            <img class="hand-card-img" src="${card.cardImage}" alt="${card.id}" onerror="this.style.display='none'">
            <div class="hand-card-name">${esc(card.id)}</div>
            <div class="hand-card-value">${card.value} hasar</div>
            ${card.type !== 'normal' ? `<div class="hand-card-type badge badge-${card.type}">${card.type}</div>` : ''}
        `;
        if (!disabled) div.onclick = () => playCard(card.id);
        container.appendChild(div);
    });
}

function playCard(cardId) {
    socket.emit('playCard', { roomId: currentRoomId, cardId });
}

// ── Timer ──────────────────────────────────────────────────────────────────────
function startTimer(ms) {
    stopTimer();
    const bar = $('timer-bar');
    const start = Date.now();
    bar.style.width = '100%';
    bar.classList.remove('urgent');
    timerInterval = setInterval(() => {
        const elapsed = Date.now() - start;
        const pct = Math.max(0, 1 - elapsed / ms) * 100;
        bar.style.width = pct + '%';
        if (pct < 25) bar.classList.add('urgent');
        if (pct <= 0) stopTimer();
    }, 100);
}
function stopTimer() { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } }

// ── Escape HTML ────────────────────────────────────────────────────────────────
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ── Socket Events ──────────────────────────────────────────────────────────────
socket.on('connect', () => { myId = socket.id; });

socket.on('roomCreated', (state) => {
    currentRoomId = state.id; isHost = true;
    showScreen('game');
    $('room-code').innerHTML = `Oda: <span>${state.id}</span>`;
    $('start-game-btn').style.display = 'inline-flex';
    renderPlayers(state); renderHand(state.myHand, false);
    toast('Oda oluşturuldu!', 'success');
    if (!canvas) setTimeout(initCanvas, 100);
});

socket.on('roomJoined', (state) => {
    currentRoomId = state.id; isHost = false;
    showScreen('game');
    $('room-code').innerHTML = `Oda: <span>${state.id}</span>`;
    $('start-game-btn').style.display = 'none';
    renderPlayers(state); renderHand(state.myHand, false);
    toast('Odaya katıldın!', 'success');
    if (!canvas) setTimeout(initCanvas, 100);
});

socket.on('roomUpdated', (state) => {
    renderPlayers(state);
    const isMyTurn = state.currentPlayerId === myId && state.gameState === 'playing';
    renderHand(state.myHand, isMyTurn);
    if (state.currentPlayerId) {
        const cp = state.players.find(p => p.id === state.currentPlayerId);
        $('turn-text').innerHTML = cp ? `Sıra: <span class="current-turn">${esc(cp.username)}</span>` : '';
    }
});

socket.on('playerJoined', (data) => { toast(`${data.username} katıldı (${data.playerCount}/4)`, 'info'); });
socket.on('playerLeft', (data) => { toast(`${data.username} ayrıldı`, 'warning'); });
socket.on('becameHost', () => { isHost = true; $('start-game-btn').style.display = 'inline-flex'; toast('Artık sen hostsun!', 'warning'); });

socket.on('gameStarted', () => {
    $('start-game-btn').style.display = 'none';
    $('waiting-area').style.display = 'none';
    $('question-panel').style.display = 'block';
    toast('Oyun başladı!', 'success');
});

socket.on('newQuestion', (q) => {
    $('question-panel').style.display = 'block';
    $('q-played-by').innerHTML = `<strong>${esc(q.playedBy)}</strong> tarafından oynandı (${q.recoilTaken} geri tepme)`;
    // Type badge
    $('q-type-badge').className = `badge badge-${q.type}`;
    $('q-type-badge').textContent = q.type;
    $('q-value').textContent = q.value + ' hasar';
    // Images
    $('q-card-img').src = q.cardImage; $('q-card-img').onerror = function(){ this.style.display='none'; };
    $('q-question-img').src = q.questionImage; $('q-question-img').onerror = function(){ this.style.display='none'; };
    // Options
    const opts = $('options-grid');
    opts.innerHTML = '';
    const isCardPlayer = q.playedBy === ($('username').value.trim());
    ['a','b','c','d'].forEach(key => {
        const btn = document.createElement('button');
        btn.className = 'option-btn';
        btn.disabled = isCardPlayer;
        btn.innerHTML = `<span class="option-label">${key.toUpperCase()}</span>${esc(q[key])}`;
        btn.onclick = () => { submitAnswer(key); opts.querySelectorAll('.option-btn').forEach(b => b.disabled = true); };
        opts.appendChild(btn);
    });
    startTimer(q.timeoutMs || 30000);
    clearCanvas();
});

function submitAnswer(answer) { socket.emit('submitAnswer', { roomId: currentRoomId, answer }); }

socket.on('answerResult', (data) => {
    stopTimer();
    toast(data.message, data.correct ? 'success' : 'error');
});

socket.on('drewCards', (data) => { toast(`${data.count} kart çektin!`, 'info'); });
socket.on('playerEliminated', (data) => { toast(`${data.username} elendi!`, 'warning'); });

socket.on('turnChanged', (data) => {
    $('turn-text').innerHTML = `Sıra: <span class="current-turn">${esc(data.username)}</span>`;
    if (data.playerId === myId) toast('Senin sıran! Bir kart oyna.', 'warning');
});

socket.on('gameOver', (data) => {
    stopTimer();
    $('game-over-overlay').classList.add('visible');
    $('winner-name').textContent = data.winner || 'Kimse';
    $('eliminated-list').textContent = data.eliminated.length ? 'Elenenler: ' + data.eliminated.join(', ') : '';
});

socket.on('error', (data) => { toast(data.message || data, 'error'); });

function returnToLobby() {
    $('game-over-overlay').classList.remove('visible');
    showScreen('lobby');
    currentRoomId = null; isHost = false;
    $('question-panel').style.display = 'none';
}

// ── Keyboard shortcut ──────────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const map = { '1': 'a', '2': 'b', '3': 'c', '4': 'd' };
    if (map[e.key]) {
        const btns = $('options-grid').querySelectorAll('.option-btn:not(:disabled)');
        const idx = 'abcd'.indexOf(map[e.key]);
        if (btns[idx]) btns[idx].click();
    }
});
