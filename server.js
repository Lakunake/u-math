const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

// ── App Setup ──────────────────────────────────────────────────────────────────

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.static('public'));
app.use('/questions', express.static('questions'));
app.use('/cards', express.static('cards'));

const PORT = process.env.PORT || 3000;

// ── Constants ──────────────────────────────────────────────────────────────────

const MAX_PLAYERS = 4;
const INITIAL_HP = 200;
const HAND_SIZE = 5;
const ANSWER_TIMEOUT_MS = 30000;
const RECOIL_DIVISOR = 3;

// ── Question Pool ──────────────────────────────────────────────────────────────

const questionsDir = path.join(__dirname, 'questions');
const cardsDir = path.join(__dirname, 'cards');

// Ensure directories exist
[questionsDir, cardsDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
});

let questionPool = [];

function loadQuestions() {
    const questions = [];
    try {
        const files = fs.readdirSync(questionsDir).filter(f => f.endsWith('.json'));
        for (const file of files) {
            try {
                const raw = fs.readFileSync(path.join(questionsDir, file), 'utf8');
                const q = JSON.parse(raw);
                q.id = file.replace('.json', '');
                // Default values for optional fields
                q.type = q.type || 'normal';   // normal | skip | reverse | draw2
                q.value = q.value || 20;
                questions.push(q);
            } catch (err) {
                console.error(`[Questions] Failed to load ${file}:`, err.message);
            }
        }
    } catch (err) {
        console.error('[Questions] Failed to read directory:', err.message);
    }
    return questions;
}

// Initial load
questionPool = loadQuestions();
console.log(`[Questions] Loaded ${questionPool.length} question(s)`);

// Hot-reload on file changes
fs.watch(questionsDir, { persistent: false }, (eventType, filename) => {
    if (filename && filename.endsWith('.json')) {
        questionPool = loadQuestions();
        console.log(`[Questions] Reloaded — now ${questionPool.length} question(s)`);
    }
});

// ── Room State ─────────────────────────────────────────────────────────────────

const rooms = new Map();

/**
 * Create a shuffled copy of the question pool for use as a draw pile.
 * Uses Fisher-Yates shuffle.
 */
function createDeck() {
    const deck = [...questionPool];
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

/**
 * Draw `count` cards from the room's deck.
 * If the deck is empty, reshuffle and refill.
 */
function drawCards(room, count) {
    const drawn = [];
    for (let i = 0; i < count; i++) {
        if (room.deck.length === 0) {
            room.deck = createDeck();
        }
        drawn.push(room.deck.pop());
    }
    return drawn;
}

/**
 * Build a safe, serializable snapshot of room state for clients.
 * Hands are sent per-player (each player only sees their own hand).
 */
function roomSnapshot(room, forSocketId) {
    return {
        id: room.id,
        host: room.host,
        gameState: room.gameState,
        direction: room.direction,
        currentPlayerId: room.currentPlayerId,
        players: room.players.map(p => ({
            id: p.id,
            username: p.username,
            hp: p.hp,
            cardCount: p.hand ? p.hand.length : 0,
            isConnected: p.isConnected
        })),
        // Only include the requesting player's hand
        myHand: (() => {
            const me = room.players.find(p => p.id === forSocketId);
            return me && me.hand ? me.hand.map(c => ({
                id: c.id,
                type: c.type,
                value: c.value,
                cardImage: `/cards/${c.id}.png`
            })) : [];
        })()
    };
}

/**
 * Send personalized state to each player in the room.
 */
function broadcastRoomState(room) {
    for (const player of room.players) {
        if (player.isConnected) {
            io.to(player.id).emit('roomUpdated', roomSnapshot(room, player.id));
        }
    }
}

/**
 * Get the next alive, connected player index in turn order.
 */
function nextPlayerIndex(room, fromIndex) {
    const len = room.players.length;
    let idx = fromIndex;
    for (let attempts = 0; attempts < len; attempts++) {
        idx = (idx + room.direction + len) % len;
        const p = room.players[idx];
        if (p.hp > 0 && p.isConnected) return idx;
    }
    return -1; // no valid player found
}

// ── Socket.io Connection Handling ──────────────────────────────────────────────

io.on('connection', (socket) => {
    console.log(`[Connect] ${socket.id}`);

    // ── Create Room ────────────────────────────────────────────────────────────
    socket.on('createRoom', (username) => {
        if (!username || typeof username !== 'string') return;
        const trimmed = username.trim().substring(0, 20);
        if (!trimmed) return;

        const roomId = uuidv4().substring(0, 6).toUpperCase();
        const room = {
            id: roomId,
            host: socket.id,
            players: [{
                id: socket.id,
                username: trimmed,
                hp: INITIAL_HP,
                hand: [],
                isConnected: true
            }],
            gameState: 'waiting',
            direction: 1,          // 1 = clockwise, -1 = counter-clockwise
            currentPlayerIndex: 0,
            currentPlayerId: socket.id,
            deck: [],
            currentQuestion: null,
            answeredThisRound: new Set(),
            answerTimer: null
        };

        rooms.set(roomId, room);
        socket.join(roomId);
        socket.data.roomId = roomId;
        socket.emit('roomCreated', roomSnapshot(room, socket.id));
        console.log(`[Room] Created ${roomId} by "${trimmed}"`);
    });

    // ── Join Room ──────────────────────────────────────────────────────────────
    socket.on('joinRoom', ({ roomId, username }) => {
        if (!roomId || !username) return;
        const upperRoomId = roomId.trim().toUpperCase();
        const trimmed = username.trim().substring(0, 20);
        if (!trimmed) return;

        const room = rooms.get(upperRoomId);
        if (!room) {
            socket.emit('error', { message: 'Oda bulunamadı!' });
            return;
        }
        if (room.gameState !== 'waiting') {
            socket.emit('error', { message: 'Oyun zaten başladı!' });
            return;
        }
        if (room.players.length >= MAX_PLAYERS) {
            socket.emit('error', { message: 'Oda dolu!' });
            return;
        }
        if (room.players.some(p => p.username === trimmed)) {
            socket.emit('error', { message: 'Bu isim zaten kullanılıyor!' });
            return;
        }

        room.players.push({
            id: socket.id,
            username: trimmed,
            hp: INITIAL_HP,
            hand: [],
            isConnected: true
        });
        socket.join(upperRoomId);
        socket.data.roomId = upperRoomId;

        socket.emit('roomJoined', roomSnapshot(room, socket.id));
        socket.to(upperRoomId).emit('playerJoined', {
            username: trimmed,
            playerCount: room.players.length
        });
        broadcastRoomState(room);
        console.log(`[Room] "${trimmed}" joined ${upperRoomId} (${room.players.length}/${MAX_PLAYERS})`);
    });

    // ── Start Game ─────────────────────────────────────────────────────────────
    socket.on('startGame', (roomId) => {
        const upperRoomId = (roomId || '').toUpperCase();
        const room = rooms.get(upperRoomId);
        if (!room) return;
        if (room.host !== socket.id) return;
        if (room.gameState !== 'waiting') return;
        if (room.players.length < 2) {
            socket.emit('error', { message: 'En az 2 oyuncu gerekli!' });
            return;
        }
        if (questionPool.length === 0) {
            socket.emit('error', { message: 'Soru havuzu boş! questions/ klasörüne soru ekleyin.' });
            return;
        }

        room.gameState = 'playing';
        room.deck = createDeck();
        room.currentPlayerIndex = 0;
        room.currentPlayerId = room.players[0].id;
        room.direction = 1;

        // Deal initial hands
        for (const player of room.players) {
            player.hand = drawCards(room, HAND_SIZE);
        }

        io.to(upperRoomId).emit('gameStarted');
        broadcastRoomState(room);
        console.log(`[Game] Started in ${upperRoomId} with ${room.players.length} players`);
    });

    // ── Play Card ──────────────────────────────────────────────────────────────
    socket.on('playCard', ({ roomId, cardId }) => {
        const upperRoomId = (roomId || '').toUpperCase();
        const room = rooms.get(upperRoomId);
        if (!room || room.gameState !== 'playing') return;
        if (room.currentPlayerId !== socket.id) return; // not your turn

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        const cardIndex = player.hand.findIndex(c => c.id === cardId);
        if (cardIndex === -1) return; // card not in hand

        const card = player.hand.splice(cardIndex, 1)[0];
        room.currentQuestion = card;
        room.answeredThisRound = new Set();

        // Apply recoil to card player
        const recoil = Math.floor(card.value / RECOIL_DIVISOR);
        player.hp -= recoil;

        // Draw a replacement card
        const drawn = drawCards(room, 1);
        player.hand.push(...drawn);

        // Handle special card types before asking question
        if (card.type === 'skip') {
            // Skip: next player loses their turn AND takes the question
            const skippedIdx = nextPlayerIndex(room, room.currentPlayerIndex);
            if (skippedIdx !== -1) {
                const skippedPlayer = room.players[skippedIdx];
                // Skipped player must still answer, but alone
                room.answeredThisRound = new Set(
                    room.players.filter(p => p.id !== skippedPlayer.id && p.id !== socket.id)
                        .map(p => p.id)
                );
            }
        } else if (card.type === 'reverse') {
            room.direction *= -1;
        } else if (card.type === 'draw2') {
            const targetIdx = nextPlayerIndex(room, room.currentPlayerIndex);
            if (targetIdx !== -1) {
                const targetPlayer = room.players[targetIdx];
                const extraCards = drawCards(room, 2);
                targetPlayer.hand.push(...extraCards);
                io.to(targetPlayer.id).emit('drewCards', {
                    count: 2,
                    cards: extraCards.map(c => ({
                        id: c.id, type: c.type, value: c.value,
                        cardImage: `/cards/${c.id}.png`
                    }))
                });
            }
        }

        // Card player doesn't answer their own question
        room.answeredThisRound.add(socket.id);

        // Send question to all players
        const questionPayload = {
            id: card.id,
            type: card.type,
            a: card.a,
            b: card.b,
            c: card.c,
            d: card.d,
            value: card.value,
            questionImage: `/questions/${card.id}.png`,
            cardImage: `/cards/${card.id}.png`,
            playedBy: player.username,
            recoilTaken: recoil,
            timeoutMs: ANSWER_TIMEOUT_MS
        };

        io.to(upperRoomId).emit('newQuestion', questionPayload);
        broadcastRoomState(room);

        // Start answer timeout
        if (room.answerTimer) clearTimeout(room.answerTimer);
        room.answerTimer = setTimeout(() => {
            handleRoundTimeout(upperRoomId);
        }, ANSWER_TIMEOUT_MS);

        console.log(`[Game] ${player.username} played "${card.id}" (${card.type}, ${card.value}dmg, ${recoil} recoil)`);
    });

    // ── Submit Answer ──────────────────────────────────────────────────────────
    socket.on('submitAnswer', ({ roomId, answer }) => {
        const upperRoomId = (roomId || '').toUpperCase();
        const room = rooms.get(upperRoomId);
        if (!room || room.gameState !== 'playing' || !room.currentQuestion) return;

        // Prevent duplicate answers
        if (room.answeredThisRound.has(socket.id)) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player || player.hp <= 0) return;

        room.answeredThisRound.add(socket.id);

        const isCorrect = answer === room.currentQuestion.answer;
        const cardValue = room.currentQuestion.value;

        if (!isCorrect) {
            player.hp -= cardValue;
            socket.emit('answerResult', {
                correct: false,
                damage: cardValue,
                message: `Yanlış! -${cardValue} HP`
            });
        } else {
            socket.emit('answerResult', {
                correct: true,
                damage: 0,
                message: 'Doğru!'
            });
        }

        broadcastRoomState(room);

        // Check if all alive non-card-players have answered
        const needToAnswer = room.players.filter(p =>
            p.hp > 0 &&
            p.isConnected &&
            !room.answeredThisRound.has(p.id)
        );

        if (needToAnswer.length === 0) {
            finishRound(upperRoomId);
        }
    });

    // ── Disconnect ─────────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
        console.log(`[Disconnect] ${socket.id}`);
        const roomId = socket.data.roomId;
        if (!roomId) return;

        const room = rooms.get(roomId);
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (player) player.isConnected = false;

        // If all players disconnected, delete room
        if (room.players.every(p => !p.isConnected)) {
            if (room.answerTimer) clearTimeout(room.answerTimer);
            rooms.delete(roomId);
            console.log(`[Room] Deleted empty room ${roomId}`);
            return;
        }

        // If host disconnected, reassign
        if (room.host === socket.id) {
            const newHost = room.players.find(p => p.isConnected);
            if (newHost) {
                room.host = newHost.id;
                io.to(newHost.id).emit('becameHost');
            }
        }

        // If it was this player's turn during a game, advance
        if (room.gameState === 'playing' && room.currentPlayerId === socket.id) {
            advanceTurn(room);
            broadcastRoomState(room);
        } else {
            broadcastRoomState(room);
        }

        // Notify room
        if (player) {
            io.to(roomId).emit('playerLeft', { username: player.username });
        }
    });
});

// ── Round Resolution ───────────────────────────────────────────────────────────

function handleRoundTimeout(roomId) {
    const room = rooms.get(roomId);
    if (!room || room.gameState !== 'playing' || !room.currentQuestion) return;

    const cardValue = room.currentQuestion.value;

    // Everyone who hasn't answered takes damage
    for (const player of room.players) {
        if (player.hp > 0 && player.isConnected && !room.answeredThisRound.has(player.id)) {
            player.hp -= cardValue;
            io.to(player.id).emit('answerResult', {
                correct: false,
                damage: cardValue,
                message: `Süre doldu! -${cardValue} HP`,
                timeout: true
            });
        }
    }

    finishRound(roomId);
}

function finishRound(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;

    if (room.answerTimer) {
        clearTimeout(room.answerTimer);
        room.answerTimer = null;
    }

    room.currentQuestion = null;

    // Check for eliminated players
    const alivePlayers = room.players.filter(p => p.hp > 0 && p.isConnected);

    if (alivePlayers.length <= 1) {
        // Game over
        const winner = alivePlayers[0];
        const eliminated = room.players.filter(p => p.hp <= 0);
        io.to(roomId).emit('gameOver', {
            winner: winner ? winner.username : null,
            eliminated: eliminated.map(p => p.username)
        });
        rooms.delete(roomId);
        console.log(`[Game] Over in ${roomId} — winner: ${winner ? winner.username : 'nobody'}`);
        return;
    }

    // Announce eliminations
    for (const player of room.players) {
        if (player.hp <= 0) {
            io.to(roomId).emit('playerEliminated', { username: player.username });
        }
    }

    advanceTurn(room);
    broadcastRoomState(room);
}

function advanceTurn(room) {
    const nextIdx = nextPlayerIndex(room, room.currentPlayerIndex);
    if (nextIdx === -1) return;
    room.currentPlayerIndex = nextIdx;
    room.currentPlayerId = room.players[nextIdx].id;

    io.to(room.id).emit('turnChanged', {
        playerId: room.currentPlayerId,
        username: room.players[nextIdx].username,
        direction: room.direction
    });
}

// ── Start Server ───────────────────────────────────────────────────────────────

server.listen(PORT, () => {
    console.log(`[Server] Running at http://localhost:${PORT}`);
});
