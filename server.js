const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

function waitAndExit(err) {
    console.error('\n' + '='.repeat(50) + '\nCRITICAL ERROR:\n' + err + '\n' + '='.repeat(50));
    console.log('\nPress Enter to exit...');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('', () => process.exit(1));
}
process.on('uncaughtException', waitAndExit);
process.on('unhandledRejection', waitAndExit);

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
app.use(cors()); app.use(express.static('public'));
app.use('/questions', express.static('questions'));
app.use('/cards', express.static('cards'));
const PORT = process.env.PORT || 3000;

// ── Constants ──────────────────────────────────────────────────────────────────
const MAX_PLAYERS = 4, INITIAL_HP = 200, HAND_SIZE = 5, ANSWER_TIMEOUT_MS = 30000, COPIES_PER_GROUP = 4;
const CARD_COLORS = ['red', 'blue', 'green'];

const JOKER_DEFS = [
    { id: 'joker_zap', jokerEffect: 'zap', value: 25, label: 'Şimşek' },
    { id: 'joker_zap', jokerEffect: 'zap', value: 25, label: 'Şimşek' },
    { id: 'joker_zap', jokerEffect: 'zap', value: 25, label: 'Şimşek' },
    { id: 'joker_heal', jokerEffect: 'heal', value: 30, label: 'İyileşme' },
    { id: 'joker_heal', jokerEffect: 'heal', value: 30, label: 'İyileşme' },
    { id: 'joker_double', jokerEffect: 'doubleDamage', value: 0, label: 'Çift Hasar' },
    { id: 'joker_double', jokerEffect: 'doubleDamage', value: 0, label: 'Çift Hasar' },
    { id: 'joker_steal', jokerEffect: 'steal', value: 0, label: 'Hırsız' },
];

// Max card number = floor(sqrt(totalQuestions)), capped at 9, min 1.
// 9 questions  → max 3 (numbers 0-3, easy to match → frequent color swaps)
// 25 questions → max 5 (numbers 0-5, moderate)
// 81 questions → max 9 (full UNO range)
function computeMaxNumber() {
    const total = questionGroups.reduce((s, g) => s + g.questions.length, 0);
    return Math.max(1, Math.min(9, Math.floor(Math.sqrt(total))));
}

function randColor() { return CARD_COLORS[Math.floor(Math.random() * CARD_COLORS.length)]; }
function randNum() { return Math.floor(Math.random() * (computeMaxNumber() + 1)); }

/** Can this card be played on the current top card? (color OR number match, joker = wild) */
function isPlayable(card, topCard) {
    if (!topCard) return true;
    if (card.type === 'joker') return true;
    return card.color === topCard.color || card.number === topCard.number;
}

// ── Question Groups ────────────────────────────────────────────────────────────
const questionsDir = path.join(__dirname, 'questions');
const cardsDir = path.join(__dirname, 'cards');
[questionsDir, cardsDir].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d); });
let questionGroups = [];

function normalizeMeta(meta) {
    if (Array.isArray(meta.types) && meta.types.length > 0) return meta.types;
    return [{ type: meta.type || 'normal', weight: 1 }];
}

function loadQuestionGroups() {
    const groups = [];
    try {
        for (const entry of fs.readdirSync(questionsDir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const gid = entry.name, gdir = path.join(questionsDir, gid);
            let meta = { value: 20 };
            const mp = path.join(gdir, 'meta.json');
            if (fs.existsSync(mp)) { try { meta = JSON.parse(fs.readFileSync(mp, 'utf8')); } catch (e) { console.error(`Bad meta ${gid}:`, e.message); } }
            const questions = [];
            for (const f of fs.readdirSync(gdir).filter(f => f.endsWith('.json') && f !== 'meta.json')) {
                try { const q = JSON.parse(fs.readFileSync(path.join(gdir, f), 'utf8')); q.qId = f.replace('.json', ''); if (!q.difficulty) q.difficulty = 'medium'; questions.push(q); }
                catch (e) { console.error(`Failed ${gid}/${f}:`, e.message); }
            }
            if (!questions.length) continue;
            const types = normalizeMeta(meta);
            groups.push({ id: gid, types, value: meta.value || 20, questions });
            console.log(`[Q] ${gid}: ${questions.length}q, types=[${types.map(t => `${t.type}(${t.weight})`).join('/')}], val=${meta.value || 20}`);
        }
    } catch (e) { console.error('[Q] Read dir failed:', e.message); }
    return groups;
}
questionGroups = loadQuestionGroups();
console.log(`[Q] Loaded ${questionGroups.length} group(s)`);
fs.watch(questionsDir, { persistent: false, recursive: true }, (ev, fn) => {
    if (fn && fn.endsWith('.json')) { questionGroups = loadQuestionGroups(); console.log(`[Q] Reloaded → ${questionGroups.length}`); }
});

function pickQuestion(room, group, forcedDifficulty) {
    if (!room.seenQ) room.seenQ = new Map();
    if (!room.seenQ.has(group.id)) room.seenQ.set(group.id, new Set());
    const seen = room.seenQ.get(group.id);
    if (seen.size >= group.questions.length) seen.clear();
    let pool = group.questions.filter(q => !seen.has(q.qId));
    if (forcedDifficulty) {
        const f = pool.filter(q => q.difficulty === forcedDifficulty);
        if (f.length) pool = f;
    } else {
        const w = { easy: 40, medium: 50, hard: 10 }, byD = {};
        for (const q of pool) { const d = q.difficulty || 'medium'; (byD[d] || (byD[d] = [])).push(q); }
        const diffs = Object.keys(byD);
        if (diffs.length > 1) {
            let tot = 0; for (const d of diffs) tot += (w[d] || 30);
            let r = Math.random() * tot, ch = diffs[0];
            for (const d of diffs) { r -= (w[d] || 30); if (r <= 0) { ch = d; break; } }
            pool = byD[ch];
        }
    }
    const picked = pool[Math.floor(Math.random() * pool.length)];
    seen.add(picked.qId);
    return picked;
}

// ── Pool & Cards ───────────────────────────────────────────────────────────────
const rooms = new Map();
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; }
function rollCardType(g) {
    const t = g.types; if (t.length === 1) return t[0].type;
    const tot = t.reduce((s, e) => s + (e.weight || 1), 0); let r = Math.random() * tot;
    for (const e of t) { r -= (e.weight || 1); if (r <= 0) return e.type; } return t[t.length - 1].type;
}

function createPool() {
    const pool = [];
    for (const g of questionGroups)
        for (let i = 0; i < COPIES_PER_GROUP; i++)
            pool.push({ uid: uuidv4(), id: g.id, type: rollCardType(g), value: g.value, color: randColor(), number: randNum() });
    for (const d of JOKER_DEFS)
        pool.push({ uid: uuidv4(), id: d.id, type: 'joker', jokerEffect: d.jokerEffect, value: d.value, label: d.label, color: 'wild', number: null });
    return shuffle(pool);
}

function drawFromPool(room, count) {
    const drawn = [];
    for (let i = 0; i < count; i++) { if (!room.pool.length) room.pool = createPool(); drawn.push(room.pool.pop()); }
    return drawn;
}

function drawCardsForDraw2() {
    const c = [];
    const g1 = questionGroups[Math.floor(Math.random() * questionGroups.length)];
    c.push({ uid: uuidv4(), id: g1.id, type: rollCardType(g1), value: g1.value, forcedDifficulty: 'hard', color: randColor(), number: randNum() });
    const g2 = questionGroups[Math.floor(Math.random() * questionGroups.length)];
    c.push({ uid: uuidv4(), id: g2.id, type: rollCardType(g2), value: g2.value, forcedDifficulty: 'medium', color: randColor(), number: randNum() });
    return c;
}

function drawCardsForDraw4(room) {
    const c = [];
    const g1 = questionGroups[Math.floor(Math.random() * questionGroups.length)];
    c.push({ uid: uuidv4(), id: g1.id, type: rollCardType(g1), value: g1.value, forcedDifficulty: 'hard', color: randColor(), number: randNum() });
    const g2 = questionGroups[Math.floor(Math.random() * questionGroups.length)];
    c.push({ uid: uuidv4(), id: g2.id, type: rollCardType(g2), value: g2.value, forcedDifficulty: 'medium', color: randColor(), number: randNum() });
    c.push(...drawFromPool(room, 2));
    return c;
}

function roomSnapshot(room, forSocketId) {
    const me = room.players.find(p => p.id === forSocketId);
    const myHand = me && me.hand ? me.hand.map(c => ({
        uid: c.uid, id: c.id, type: c.type, value: c.value, color: c.color || 'wild',
        number: c.number ?? null,
        cardImage: c.type === 'joker' ? null : `/cards/${c.id}.png`,
        forcedDifficulty: c.forcedDifficulty || null,
        jokerEffect: c.jokerEffect || null, label: c.label || c.id,
        playable: isPlayable(c, room.topCard)
    })) : [];
    return {
        id: room.id, host: room.host, gameState: room.gameState,
        direction: room.direction, currentPlayerId: room.currentPlayerId,
        poolSize: room.pool ? room.pool.length : 0,
        topCard: room.topCard || null,
        players: room.players.map(p => ({ id: p.id, username: p.username, hp: p.hp, cardCount: p.hand ? p.hand.length : 0, isConnected: p.isConnected })),
        myHand
    };
}

function broadcastRoomState(room) { for (const p of room.players) if (p.isConnected) io.to(p.id).emit('roomUpdated', roomSnapshot(room, p.id)); }
function nextPlayerIndex(room, from) {
    const len = room.players.length; let idx = from;
    for (let a = 0; a < len; a++) { idx = (idx + room.direction + len) % len; const p = room.players[idx]; if (p.hp > 0 && p.isConnected) return idx; }
    return -1;
}
function checkEliminations(room) {
    const alive = room.players.filter(p => p.hp > 0 && p.isConnected);
    if (alive.length <= 1) {
        const w = alive[0]; io.to(room.id).emit('gameOver', { winner: w ? w.username : null, eliminated: room.players.filter(p => p.hp <= 0).map(p => p.username) });
        rooms.delete(room.id); return true;
    }
    for (const p of room.players) {
        if (p.hp <= 0 && !p.eliminated) {
            p.eliminated = true;
            io.to(room.id).emit('playerEliminated', { username: p.username });
        }
    }
    return false;
}

// ── Socket.io ──────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
    socket.on('createRoom', (username) => {
        if (!username || typeof username !== 'string') return;
        const name = username.trim().substring(0, 20); if (!name) return;
        const roomId = uuidv4().substring(0, 6).toUpperCase();
        const room = {
            id: roomId, host: socket.id, players: [{ id: socket.id, username: name, hp: INITIAL_HP, hand: [], isConnected: true }],
            gameState: 'waiting', direction: 1, currentPlayerIndex: 0, currentPlayerId: socket.id,
            pool: [], currentQuestion: null, answeredThisRound: new Set(), answerTimer: null,
            seenQ: new Map(), doubleDamageActive: false, topCard: null
        };
        rooms.set(roomId, room); socket.join(roomId); socket.data.roomId = roomId;
        socket.emit('roomCreated', roomSnapshot(room, socket.id));
    });

    socket.on('joinRoom', ({ roomId, username }) => {
        if (!roomId || !username) return;
        const uid = roomId.trim().toUpperCase(), name = username.trim().substring(0, 20);
        if (!name) return; const room = rooms.get(uid);
        if (!room) { socket.emit('error', { message: 'Oda bulunamadı!' }); return; }
        if (room.gameState !== 'waiting') { socket.emit('error', { message: 'Oyun zaten başladı!' }); return; }
        if (room.players.length >= MAX_PLAYERS) { socket.emit('error', { message: 'Oda dolu!' }); return; }
        if (room.players.some(p => p.username === name)) { socket.emit('error', { message: 'Bu isim zaten kullanılıyor!' }); return; }
        room.players.push({ id: socket.id, username: name, hp: INITIAL_HP, hand: [], isConnected: true });
        socket.join(uid); socket.data.roomId = uid;
        socket.emit('roomJoined', roomSnapshot(room, socket.id));
        socket.to(uid).emit('playerJoined', { username: name, playerCount: room.players.length });
        broadcastRoomState(room);
    });

    socket.on('startGame', (roomId) => {
        const uid = (roomId || '').toUpperCase(), room = rooms.get(uid);
        if (!room || room.host !== socket.id || room.gameState !== 'waiting') return;
        if (room.players.length < 2) { socket.emit('error', { message: 'En az 2 oyuncu gerekli!' }); return; }
        if (!questionGroups.length) { socket.emit('error', { message: 'Soru havuzu boş!' }); return; }
        room.gameState = 'playing'; room.pool = createPool();
        room.currentPlayerIndex = 0; room.currentPlayerId = room.players[0].id; room.direction = 1;
        for (const p of room.players) p.hand = drawFromPool(room, HAND_SIZE);
        // Flip starting top card from pool (like UNO)
        const startCard = drawFromPool(room, 1)[0];
        const maxN = computeMaxNumber();
        room.topCard = {
            color: startCard.color === 'wild' ? randColor() : startCard.color,
            number: startCard.number ?? Math.floor(Math.random() * (maxN + 1))
        };
        io.to(uid).emit('gameStarted');
        broadcastRoomState(room);
        console.log(`[Game] Started ${uid}, ${room.players.length}p, pool:${room.pool.length}, topCard:${room.topCard.color}/${room.topCard.number}, maxN:${maxN}`);
    });

    // ── Play Card ──────────────────────────────────────────────────────────────
    socket.on('playCard', ({ roomId, cardUid }) => {
        const uid = (roomId || '').toUpperCase(), room = rooms.get(uid);
        if (!room || room.gameState !== 'playing' || room.currentPlayerId !== socket.id || room.currentQuestion) return;
        const player = room.players.find(p => p.id === socket.id); if (!player) return;
        const ci = player.hand.findIndex(c => c.uid === cardUid); if (ci === -1) return;
        const card = player.hand[ci];

        // Validate color/number match
        if (!isPlayable(card, room.topCard)) {
            socket.emit('error', { message: 'Bu kartı oynayamazsın! Renk veya numara eşleşmeli.' });
            return;
        }
        player.hand.splice(ci, 1);

        // Update top card — jokers set random color, keep number null (wild)
        if (card.type === 'joker') {
            room.topCard = { color: randColor(), number: randNum() };
        } else {
            room.topCard = { color: card.color, number: card.number };
        }

        // ── JOKER ──────────────────────────────────────────────────────────
        if (card.type === 'joker') {
            const ti = nextPlayerIndex(room, room.currentPlayerIndex);
            const target = ti !== -1 ? room.players[ti] : null;
            const eff = card.jokerEffect;
            if (eff === 'zap' && target) { target.hp -= card.value; io.to(uid).emit('jokerPlayed', { playedBy: player.username, effect: 'zap', target: target.username, value: card.value, label: card.label }); }
            else if (eff === 'heal') { player.hp = Math.min(INITIAL_HP, player.hp + card.value); io.to(uid).emit('jokerPlayed', { playedBy: player.username, effect: 'heal', value: card.value, label: card.label }); }
            else if (eff === 'doubleDamage') { room.doubleDamageActive = true; io.to(uid).emit('jokerPlayed', { playedBy: player.username, effect: 'doubleDamage', label: card.label }); }
            else if (eff === 'steal' && target && target.hand.length) {
                const si = Math.floor(Math.random() * target.hand.length);
                player.hand.push(target.hand.splice(si, 1)[0]);
                io.to(uid).emit('jokerPlayed', { playedBy: player.username, effect: 'steal', target: target.username, label: card.label });
            }
            player.hand.push(...drawFromPool(room, 1));
            if (checkEliminations(room)) return;
            advanceTurn(room); broadcastRoomState(room); return;
        }

        // ── QUESTION CARD ──────────────────────────────────────────────────
        const group = questionGroups.find(g => g.id === card.id); if (!group) return;
        const question = pickQuestion(room, group, card.forcedDifficulty);
        let qval = card.value; if (room.doubleDamageActive) { qval *= 2; room.doubleDamageActive = false; }
        room.currentQuestion = { ...question, groupId: card.id, type: card.type, value: qval };
        room.answeredThisRound = new Set();
        player.hand.push(...drawFromPool(room, 1));

        const alive = room.players.filter(p => p.hp > 0 && p.isConnected), two = alive.length === 2;
        if (card.type === 'skip') { if (two) room.keepTurn = true; else room.skipNextPlayer = true; }
        else if (card.type === 'reverse') { room.direction *= -1; if (two) room.keepTurn = true; }
        else if (card.type === 'draw2') {
            const ti = nextPlayerIndex(room, room.currentPlayerIndex);
            if (ti !== -1) { const tp = room.players[ti]; const ex = drawCardsForDraw2(); tp.hand.push(...ex); io.to(tp.id).emit('drewCards', { count: 2, cards: ex.map(c => ({ id: c.id, type: c.type, value: c.value, color: c.color, cardImage: `/cards/${c.id}.png`, forcedDifficulty: c.forcedDifficulty })) }); }
        } else if (card.type === 'draw4') {
            const ti = nextPlayerIndex(room, room.currentPlayerIndex);
            if (ti !== -1) { const tp = room.players[ti]; const ex = drawCardsForDraw4(room); tp.hand.push(...ex); io.to(tp.id).emit('drewCards', { count: 4, cards: ex.map(c => ({ id: c.id, type: c.type, value: c.value, color: c.color || 'wild', cardImage: c.type === 'joker' ? null : `/cards/${c.id}.png`, forcedDifficulty: c.forcedDifficulty || null })) }); }
        }

        const q = room.currentQuestion;
        io.to(uid).emit('newQuestion', {
            id: card.id, qId: q.qId, type: card.type, a: q.a, b: q.b, c: q.c, d: q.d,
            value: qval, difficulty: q.difficulty || 'medium', color: card.color,
            questionImage: `/questions/${card.id}/${q.qId}.png`, cardImage: `/cards/${card.id}.png`,
            playedBy: player.username, timeoutMs: ANSWER_TIMEOUT_MS
        });
        broadcastRoomState(room);
        if (room.answerTimer) clearTimeout(room.answerTimer);
        room.answerTimer = setTimeout(() => handleRoundTimeout(uid), ANSWER_TIMEOUT_MS);
    });

    // ── Draw Card (can't play) ─────────────────────────────────────────────
    socket.on('drawCard', (roomId) => {
        const uid = (roomId || '').toUpperCase(), room = rooms.get(uid);
        if (!room || room.gameState !== 'playing' || room.currentPlayerId !== socket.id || room.currentQuestion) return;
        const player = room.players.find(p => p.id === socket.id); if (!player) return;
        // Verify player truly has no playable cards
        if (player.hand.some(c => isPlayable(c, room.topCard))) {
            socket.emit('error', { message: 'Oynayabilecek kartın var!' });
            return;
        }
        const drawn = drawFromPool(room, 1);
        player.hand.push(...drawn);
        io.to(uid).emit('cardDrawn', { username: player.username });
        advanceTurn(room);
        broadcastRoomState(room);
    });

    socket.on('submitAnswer', ({ roomId, answer }) => {
        const uid = (roomId || '').toUpperCase(), room = rooms.get(uid);
        if (!room || room.gameState !== 'playing' || !room.currentQuestion) return;
        if (room.answeredThisRound.has(socket.id)) return;
        const player = room.players.find(p => p.id === socket.id); if (!player || player.hp <= 0) return;
        room.answeredThisRound.add(socket.id);
        const correct = answer === room.currentQuestion.answer, dmg = room.currentQuestion.value;
        if (!correct) { player.hp -= dmg; socket.emit('answerResult', { correct: false, damage: dmg, message: `Yanlış! -${dmg} HP` }); }
        else { socket.emit('answerResult', { correct: true, damage: 0, message: 'Doğru!' }); }
        broadcastRoomState(room);
        if (!room.players.filter(p => p.hp > 0 && p.isConnected && !room.answeredThisRound.has(p.id)).length) finishRound(uid);
    });

    socket.on('disconnect', () => {
        const roomId = socket.data.roomId; if (!roomId) return;
        const room = rooms.get(roomId); if (!room) return;
        const player = room.players.find(p => p.id === socket.id); if (player) player.isConnected = false;
        if (room.players.every(p => !p.isConnected)) { if (room.answerTimer) clearTimeout(room.answerTimer); rooms.delete(roomId); return; }
        if (room.host === socket.id) { const nh = room.players.find(p => p.isConnected); if (nh) { room.host = nh.id; io.to(nh.id).emit('becameHost'); } }
        if (room.gameState === 'playing' && room.currentPlayerId === socket.id) {
            if (room.currentQuestion) { room.answeredThisRound.add(socket.id); if (!room.players.filter(p => p.hp > 0 && p.isConnected && !room.answeredThisRound.has(p.id)).length) finishRound(roomId); }
            else { advanceTurn(room); broadcastRoomState(room); }
        } else broadcastRoomState(room);
        if (player) io.to(roomId).emit('playerLeft', { username: player.username });
    });
});

// ── Round Resolution ───────────────────────────────────────────────────────────
function handleRoundTimeout(roomId) {
    const room = rooms.get(roomId); if (!room || room.gameState !== 'playing' || !room.currentQuestion) return;
    const dmg = room.currentQuestion.value;
    for (const p of room.players) if (p.hp > 0 && p.isConnected && !room.answeredThisRound.has(p.id)) { p.hp -= dmg; io.to(p.id).emit('answerResult', { correct: false, damage: dmg, message: `Süre doldu! -${dmg} HP`, timeout: true }); }
    finishRound(roomId);
}
function finishRound(roomId) {
    const room = rooms.get(roomId); if (!room) return;
    if (room.answerTimer) { clearTimeout(room.answerTimer); room.answerTimer = null; }
    room.currentQuestion = null;
    if (checkEliminations(room)) return;
    advanceTurn(room); broadcastRoomState(room);
}
function advanceTurn(room) {
    if (room.keepTurn) { room.keepTurn = false; io.to(room.id).emit('turnChanged', { playerId: room.currentPlayerId, username: room.players[room.currentPlayerIndex].username, direction: room.direction, extraTurn: true }); return; }
    let ni = nextPlayerIndex(room, room.currentPlayerIndex); if (ni === -1) return;
    if (room.skipNextPlayer) { room.skipNextPlayer = false; const sk = room.players[ni]; if (sk) io.to(room.id).emit('playerSkipped', { username: sk.username }); const n2 = nextPlayerIndex(room, ni); if (n2 !== -1) ni = n2; }
    room.currentPlayerIndex = ni; room.currentPlayerId = room.players[ni].id;
    io.to(room.id).emit('turnChanged', { playerId: room.currentPlayerId, username: room.players[ni].username, direction: room.direction });
}
server.listen(PORT, () => console.log(`[Server] http://localhost:${PORT}`));
