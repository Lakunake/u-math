// U-MAt(hematics) — Client Logic
const socket = io();
let currentRoomId = null, isHost = false, myId = null, canvas = null, timerInterval = null;

// ── Mute Toggle ────────────────────────────────────────────────────────
function toggleMute() {
    const muted = !SFX.isEnabled();
    SFX.setEnabled(!muted);
    const btn = $('mute-btn');
    if (btn) btn.textContent = muted ? '🔇' : '🔊';
}

// ── Toast ──────────────────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
    const icons = { success: '✓', error: '✗', info: 'ℹ', warning: '⚠' };
    const c = document.getElementById('toast-container'), el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ'}</span><span class="toast-message">${msg}</span>`;
    c.appendChild(el); setTimeout(() => { el.classList.add('toast-exit'); setTimeout(() => el.remove(), 300); }, 3500);
}
const $ = id => document.getElementById(id);
function showScreen(s) { $('lobby').style.display = s === 'lobby' ? 'block' : 'none'; $('game-container').style.display = s === 'game' ? 'flex' : 'none'; }
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ── Lobby ──────────────────────────────────────────────────────────────────────
function createRoom() { const n = $('username').value.trim(); if (!n) { toast('Lütfen bir isim girin!', 'warning'); return; } socket.emit('createRoom', n); }
function joinRoom() { const n = $('username').value.trim(), c = $('roomIdInput').value.trim(); if (!n) { toast('Lütfen bir isim girin!', 'warning'); return; } if (!c) { toast('Lütfen oda kodunu girin!', 'warning'); return; } socket.emit('joinRoom', { roomId: c, username: n }); }
function startGame() { if (currentRoomId) socket.emit('startGame', currentRoomId); }
function drawCard() { if (currentRoomId) socket.emit('drawCard', currentRoomId); }

// ── Canvas ─────────────────────────────────────────────────────────────────────
function initCanvas() { const w = document.querySelector('.canvas-wrapper'); canvas = new fabric.Canvas('solver-canvas', { isDrawingMode: true, width: w.clientWidth || 600, height: 300 }); canvas.freeDrawingBrush = new fabric.PencilBrush(canvas); canvas.freeDrawingBrush.width = 2; canvas.freeDrawingBrush.color = '#000'; canvas.backgroundColor = '#fff'; canvas.renderAll(); }
function clearCanvas() { if (canvas) { canvas.clear(); canvas.backgroundColor = '#fff'; canvas.renderAll(); } }
function onColorChange(e) { if (canvas) canvas.freeDrawingBrush.color = e.target.value; }
function onBrushSize(e) { if (canvas) canvas.freeDrawingBrush.width = parseInt(e.target.value, 10); }
function toggleEraser() { if (!canvas) return; const is = canvas.freeDrawingBrush.color === '#ffffff'; canvas.freeDrawingBrush.color = is ? ($('draw-color').value || '#000') : '#ffffff'; canvas.freeDrawingBrush.width = is ? 2 : 20; toast(is ? 'Kalem modu' : 'Silgi modu', 'info'); }

// ── Helpers ────────────────────────────────────────────────────────────────────
function hpColor(hp) { const p = Math.max(0, hp) / 200; return p > 0.5 ? 'var(--hp-high)' : p > 0.25 ? 'var(--hp-mid)' : 'var(--hp-low)'; }
const difficultyLabels = { easy: 'Kolay', medium: 'Orta', hard: 'Zor' };
const jokerDescriptions = { zap: 'Rakibe hasar', heal: 'HP kazan', doubleDamage: '2x hasar', steal: 'Kart çal' };
const colorCSS = { red: '#ef4444', blue: '#3b82f6', green: '#22c55e', wild: '#a855f7' };
const colorLabels = { red: 'Kırmızı', blue: 'Mavi', green: 'Yeşil', wild: 'Joker' };

// ── Render Players ─────────────────────────────────────────────────────────────
function renderPlayers(state) {
    const g = $('players-grid'); g.innerHTML = '';
    state.players.forEach(p => {
        const pct = Math.max(0, (p.hp / 200) * 100), isTurn = p.id === state.currentPlayerId;
        const cls = ['player-card', 'glass-panel', isTurn ? 'is-turn' : '', p.hp <= 0 ? 'is-dead' : '', !p.isConnected ? 'is-disconnected' : ''].filter(Boolean).join(' ');
        const hb = p.id === state.host ? '<span class="host-badge">Host</span>' : '';
        g.innerHTML += `<div class="${cls}"><div class="player-name">${esc(p.username)}${hb}</div><div class="player-meta">${p.cardCount} kart</div><div class="hp-bar-container"><div class="hp-bar" style="width:${pct}%;background:${hpColor(p.hp)}"></div></div><div class="hp-text">HP: ${Math.max(0, p.hp)} / 200</div></div>`;
    });
}

// ── Top Card Indicator ─────────────────────────────────────────────────────────
function renderTopCard(state) {
    const el = $('top-card-indicator');
    if (!el || !state.topCard) return;
    const tc = state.topCard;
    const c = tc.color;
    el.style.display = state.gameState === 'playing' ? 'flex' : 'none';
    const numBadge = tc.number !== null && tc.number !== undefined
        ? `<span class="top-card-number" style="background:${colorCSS[c] || '#888'}">${tc.number}</span>`
        : `<span class="top-card-number" style="background:#a855f7">🃏</span>`;
    el.innerHTML = `<span class="top-card-dot" style="background:${colorCSS[c] || '#888'}"></span>${numBadge}<span class="top-card-label">${colorLabels[c] || c}</span><span class="pool-count">(Havuz: ${state.poolSize})</span>`;
}

// ── Render Hand ────────────────────────────────────────────────────────────────
function renderHand(hand, isMyTurn) {
    const container = $('hand-cards');
    container.innerHTML = '';
    if (!hand || !hand.length) { container.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem">El boş</p>'; return; }
    let hasPlayable = false;
    hand.forEach(card => {
        const canPlay = isMyTurn && card.playable;
        if (canPlay) hasPlayable = true;
        const disabled = !canPlay;
        const div = document.createElement('div');
        const borderColor = colorCSS[card.color] || '#888';
        div.className = `hand-card glass-panel${disabled ? ' disabled' : ''}${card.type === 'joker' ? ' joker-card' : ''}`;
        div.style.borderLeftColor = borderColor;
        div.style.borderLeftWidth = '4px';

        if (card.type === 'joker') {
            div.innerHTML = `
                <div class="hand-card-joker-icon">🃏</div>
                <div class="hand-card-name">${esc(card.label)}</div>
                <div class="hand-card-value">${jokerDescriptions[card.jokerEffect] || ''}</div>
                ${card.value ? `<div class="hand-card-value">${card.value} HP</div>` : ''}
                <div class="hand-card-type badge badge-joker">Joker</div>
            `;
        } else {
            const diffBadge = card.forcedDifficulty ? `<div class="hand-card-difficulty badge badge-${card.forcedDifficulty}">${difficultyLabels[card.forcedDifficulty] || card.forcedDifficulty}</div>` : '';
            const numDisplay = card.number !== null && card.number !== undefined
                ? `<div class="hand-card-number" style="background:${borderColor}">${card.number}</div>`
                : '';
            div.innerHTML = `
                <div class="hand-card-color-dot" style="background:${borderColor}"></div>
                <img class="hand-card-img" src="${card.cardImage}" alt="${card.id}" onerror="this.style.display='none'">
                <div class="hand-card-name">${esc(card.label)}</div>
                ${numDisplay}
                <div class="hand-card-value">${card.value} hasar</div>
                ${card.type !== 'normal' ? `<div class="hand-card-type badge badge-${card.type}">${card.type}</div>` : ''}
                ${diffBadge}
            `;
        }
        if (!disabled) div.onclick = () => playCard(card.uid);
        container.appendChild(div);
    });
    // Show/hide draw button
    const drawBtn = $('draw-card-btn');
    if (drawBtn) drawBtn.style.display = (isMyTurn && !hasPlayable) ? 'inline-flex' : 'none';
}

function playCard(cardUid) { SFX.cardPlay(); socket.emit('playCard', { roomId: currentRoomId, cardUid }); }

// ── Timer ──────────────────────────────────────────────────────────────────────
function startTimer(ms) {
    stopTimer();
    const bar = $('timer-bar'), start = Date.now();
    bar.style.width = '100%'; bar.classList.remove('urgent');
    let lastUrgent = false;
    timerInterval = setInterval(() => {
        const elapsed = Date.now() - start;
        const p = Math.max(0, 1 - elapsed / ms) * 100;
        bar.style.width = p + '%';
        const isUrgent = p < 25;
        if (isUrgent !== lastUrgent) { if (isUrgent) bar.classList.add('urgent'); lastUrgent = isUrgent; }
        // Tick on each second, faster when urgent
        const elapsedSec = Math.floor(elapsed / 1000);
        const prevSec = Math.floor((elapsed - 100) / 1000);
        if (elapsedSec !== prevSec) SFX.tick(isUrgent);
        if (p <= 0) stopTimer();
    }, 100);
}
function stopTimer() { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } }

// ── Socket Events ──────────────────────────────────────────────────────────────
socket.on('connect', () => { myId = socket.id; });

socket.on('roomCreated', (state) => {
    currentRoomId = state.id; isHost = true; showScreen('game');
    $('room-code').innerHTML = `Oda: <span>${state.id}</span>`; $('start-game-btn').style.display = 'inline-flex';
    renderPlayers(state); renderHand(state.myHand, false); renderTopCard(state);
    toast('Oda oluşturuldu!', 'success'); if (!canvas) setTimeout(initCanvas, 100);
});
socket.on('roomJoined', (state) => {
    currentRoomId = state.id; isHost = false; showScreen('game');
    $('room-code').innerHTML = `Oda: <span>${state.id}</span>`; $('start-game-btn').style.display = 'none';
    renderPlayers(state); renderHand(state.myHand, false); renderTopCard(state);
    toast('Odaya katıldın!', 'success'); if (!canvas) setTimeout(initCanvas, 100);
});
socket.on('roomUpdated', (state) => {
    renderPlayers(state); renderTopCard(state);
    const isMyTurn = state.currentPlayerId === myId && state.gameState === 'playing';
    renderHand(state.myHand, isMyTurn);
    if (state.currentPlayerId) { const cp = state.players.find(p => p.id === state.currentPlayerId); $('turn-text').innerHTML = cp ? `Sıra: <span class="current-turn">${esc(cp.username)}</span>` : ''; }
});

socket.on('playerJoined', (d) => toast(`${d.username} katıldı (${d.playerCount}/4)`, 'info'));
socket.on('playerLeft', (d) => toast(`${d.username} ayrıldı`, 'warning'));
socket.on('becameHost', () => { isHost = true; $('start-game-btn').style.display = 'inline-flex'; toast('Artık sen hostsun!', 'warning'); });
socket.on('gameStarted', () => { $('start-game-btn').style.display = 'none'; $('waiting-area').style.display = 'none'; $('question-panel').style.display = 'block'; toast('Oyun başladı!', 'success'); });

socket.on('newQuestion', (q) => {
    $('question-panel').style.display = 'block';
    $('q-played-by').innerHTML = `<strong>${esc(q.playedBy)}</strong> tarafından oynandı`;
    $('q-type-badge').className = `badge badge-${q.type}`; $('q-type-badge').textContent = q.type;
    $('q-value').textContent = q.value + ' hasar';
    const db = $('q-difficulty-badge'); if (db) { db.className = `badge badge-${q.difficulty || 'medium'}`; db.textContent = difficultyLabels[q.difficulty] || 'Orta'; }
    const ci = $('q-card-img'); ci.style.display = ''; ci.onerror = function () { this.style.display = 'none' }; ci.src = q.cardImage;
    const qi = $('q-question-img'); qi.style.display = ''; qi.onerror = function () { this.style.display = 'none' }; qi.src = q.questionImage;
    const opts = $('options-grid'); opts.innerHTML = '';
    ['a', 'b', 'c', 'd'].forEach(k => { const b = document.createElement('button'); b.className = 'option-btn'; b.innerHTML = `<span class="option-label">${k.toUpperCase()}</span>${esc(q[k])}`; b.onclick = () => { submitAnswer(k); opts.querySelectorAll('.option-btn').forEach(x => x.disabled = true); }; opts.appendChild(b); });
    startTimer(q.timeoutMs || 30000); clearCanvas();
});

function submitAnswer(a) { socket.emit('submitAnswer', { roomId: currentRoomId, answer: a }); }
socket.on('answerResult', (d) => { stopTimer(); toast(d.message, d.correct ? 'success' : 'error'); if (d.correct) SFX.correct(); else { SFX.wrong(); if (d.damage) SFX.damage(); } });

socket.on('drewCards', (d) => { SFX.draw(); toast(`${d.count} kart çektin!`, 'info'); });
socket.on('cardDrawn', (d) => { SFX.draw(); toast(`${d.username} havuzdan kart çekti`, 'info'); });
socket.on('playerEliminated', (d) => { SFX.eliminated(); toast(`${d.username} elendi!`, 'warning'); });
socket.on('playerSkipped', (d) => { toast(`${d.username} atlandı!`, 'info'); });
socket.on('jokerPlayed', (d) => {
    SFX.joker();
    const m = { zap: `⚡ ${d.playedBy} Şimşek! ${d.target} -${d.value} HP`, heal: `💚 ${d.playedBy} İyileşme! +${d.value} HP`, doubleDamage: `🔥 ${d.playedBy} Çift Hasar! Sonraki soru 2x`, steal: `🤏 ${d.playedBy} ${d.target} oyuncusundan kart çaldı!` };
    toast(m[d.effect] || `${d.playedBy} joker kullandı!`, d.effect === 'zap' ? 'error' : 'info');
});

socket.on('turnChanged', (d) => {
    $('turn-text').innerHTML = `Sıra: <span class="current-turn">${esc(d.username)}</span>`;
    $('question-panel').style.display = 'none';
    if (d.playerId === myId) {
        const msg = d.extraTurn ? 'Ekstra tur! Tekrar oynuyorsun.' : 'Senin sıran! Bir kart oyna.';
        toast(msg, d.extraTurn ? 'info' : 'warning');
        if (d.extraTurn) SFX.extraTurn(); else SFX.yourTurn();
    }
});

socket.on('gameOver', (d) => { stopTimer(); SFX.gameOver(); $('game-over-overlay').classList.add('visible'); $('winner-name').textContent = d.winner || 'Kimse'; $('eliminated-list').textContent = d.eliminated.length ? 'Elenenler: ' + d.eliminated.join(', ') : ''; });
socket.on('error', (d) => toast(d.message || d, 'error'));
function returnToLobby() { $('game-over-overlay').classList.remove('visible'); showScreen('lobby'); currentRoomId = null; isHost = false; $('question-panel').style.display = 'none'; }

document.addEventListener('keydown', (e) => { if (e.target.tagName === 'INPUT') return; const m = { '1': 'a', '2': 'b', '3': 'c', '4': 'd' }; if (m[e.key]) { const bs = $('options-grid').querySelectorAll('.option-btn:not(:disabled)'); const i = 'abcd'.indexOf(m[e.key]); if (bs[i]) bs[i].click(); } });
