const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.static('public'));
app.use('/questions', express.static('questions'));
app.use('/cards', express.static('cards'));

const PORT = process.env.PORT || 3000;

// Oyun Odaları
const rooms = new Map();

// Soru Havuzu
const questionsDir = path.join(__dirname, 'questions');
if (!fs.existsSync(questionsDir)) {
    fs.mkdirSync(questionsDir);
}

function loadQuestions() {
    const questions = [];
    const files = fs.readdirSync(questionsDir);
    files.forEach(file => {
        if (file.endsWith('.json')) {
            try {
                const content = fs.readFileSync(path.join(questionsDir, file), 'utf8');
                const q = JSON.parse(content);
                q.id = file.replace('.json', '');
                questions.push(q);
            } catch (err) {
                console.error(`Soru yüklenemedi: ${file}`, err);
            }
        }
    });
    return questions;
}

io.on('connection', (socket) => {
    console.log('Bir kullanıcı bağlandı:', socket.id);

    // Oda Oluşturma
    socket.on('createRoom', (username) => {
        const roomId = uuidv4().substring(0, 6).toUpperCase();
        const room = {
            id: roomId,
            host: socket.id,
            players: [{ id: socket.id, username, hp: 200 }],
            gameState: 'waiting', // waiting, playing
            questions: loadQuestions(),
            currentRound: 0
        };
        rooms.set(roomId, room);
        socket.join(roomId);
        socket.emit('roomCreated', room);
        console.log(`Oda oluşturuldu: ${roomId} (Host: ${username})`);
    });

    // Odaya Katılma
    socket.on('joinRoom', ({ roomId, username }) => {
        const upperRoomId = roomId.toUpperCase();
        const room = rooms.get(upperRoomId);
        if (room) {
            if (room.players.length < 4) {
                const newPlayer = { id: socket.id, username, hp: 200 };
                room.players.push(newPlayer);
                socket.join(upperRoomId);
                
                // Joiner'a odayı direkt gönder
                socket.emit('roomJoined', room);
                // Diğerlerine güncelleme gönder
                socket.to(upperRoomId).emit('roomUpdated', room);
                
                console.log(`${username} odaya katıldı: ${upperRoomId}`);
            } else {
                socket.emit('error', 'Oda dolu!');
            }
        } else {
            socket.emit('error', 'Oda bulunamadı!');
        }
    });

    // Oyunu Başlat
    socket.on('startGame', (roomId) => {
        const upperRoomId = roomId.toUpperCase();
        const room = rooms.get(upperRoomId);
        if (room && room.host === socket.id) {
            room.gameState = 'playing';
            room.currentPlayerId = socket.id; // İlk sıradaki host olsun
            io.to(upperRoomId).emit('gameStarted', room);
            sendNextQuestion(upperRoomId);
            console.log(`Oyun başladı: ${upperRoomId}`);
        }
    });

    // Soru Gönder
    function sendNextQuestion(roomId) {
        const upperRoomId = roomId.toUpperCase();
        const room = rooms.get(upperRoomId);
        if (!room || room.questions.length === 0) return;

        const question = room.questions[Math.floor(Math.random() * room.questions.length)];
        room.currentQuestion = question;
        io.to(upperRoomId).emit('newQuestion', {
            id: question.id,
            a: question.a,
            b: question.b,
            c: question.c,
            d: question.d,
            value: question.value,
            questionImage: `/questions/${question.id}.png`,
            cardImage: `/cards/${question.id}.png`
        });
    }

    // Cevap Gönder
    socket.on('submitAnswer', ({ roomId, answer }) => {
        const upperRoomId = roomId.toUpperCase();
        const room = rooms.get(upperRoomId);
        if (room && room.currentQuestion) {
            const isCorrect = answer === room.currentQuestion.answer;
            const player = room.players.find(p => p.id === socket.id);
            const cardPlayer = room.players.find(p => p.id === room.currentPlayerId);
            const cardValue = room.currentQuestion.value;

            if (!isCorrect) {
                player.hp -= cardValue;
                socket.emit('feedback', `Yanlış! -${cardValue} HP`);
                
                // Kartı oynayan 1/3 hasar alır (recoil)
                if (cardPlayer) {
                    cardPlayer.hp -= Math.floor(cardValue / 3);
                }
            } else {
                socket.emit('feedback', 'Doğru!');
            }

            io.to(upperRoomId).emit('roomUpdated', room);
            
            // Eğer HP bittiyse oyun sonu
            const deadPlayer = room.players.find(p => p.hp <= 0);
            if (deadPlayer) {
                io.to(upperRoomId).emit('gameOver', { loser: deadPlayer.username });
                rooms.delete(upperRoomId);
            } else {
                // Her cevapta sırayı değiştir (Basit bir sıra mantığı)
                const currentIndex = room.players.findIndex(p => p.id === room.currentPlayerId);
                const nextIndex = (currentIndex + 1) % room.players.length;
                room.currentPlayerId = room.players[nextIndex].id;
                
                // Biraz bekleyip yeni soru gönder
                setTimeout(() => sendNextQuestion(upperRoomId), 2000);
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('Bir kullanıcı ayrıldı:', socket.id);
        // Odayı temizleme mantığı eklenebilir
    });
});

server.listen(PORT, () => {
    console.log(`Sunucu http://localhost:${PORT} adresinde çalışıyor`);
});
