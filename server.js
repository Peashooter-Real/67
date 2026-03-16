const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(__dirname));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const CARD_TYPES = [
    { type: 'NORMAL_1', count: 1, skip: false, label: 'คนธรรมดา', img: 'assets/card_normal.png' },
    { type: 'NORMAL_2', count: 2, skip: true, label: 'คนธรรมดา (คู่)', img: 'assets/card_normal_x2.png' },
    { type: 'PHONE_1', count: 1, skip: false, label: 'หนึ่งสาย...', img: 'assets/card_phone.png' },
    { type: 'PHONE_2', count: 2, skip: true, label: 'โทรศัพท์ (คู่)', img: 'assets/card_phone_x2.png' },
    { type: 'GUN_1', count: 1, skip: false, label: 'ตัวประกัน...', img: 'assets/card_gun.png' },
    { type: 'GUN_2', count: 2, skip: true, label: 'รูปปืน (คู่)', img: 'assets/card_gun_x2.png' },
];

const rooms = new Map();

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function createDeck() {
    let deck = [];
    for (let i = 0; i < 100; i++) {
        const template = CARD_TYPES[Math.floor(Math.random() * CARD_TYPES.length)];
        deck.push({ ...template, id: i });
    }
    return shuffle(deck);
}

function getNextCount(current, direction) {
    let next = current + direction;
    let nextDirection = direction;
    if (next > 7) { next = 6; nextDirection = -1; }
    else if (next < 1) { next = 2; nextDirection = 1; }
    return { next, nextDirection };
}

io.on('connection', (socket) => {
    socket.on('join_room', ({ roomId, username }) => {
        socket.join(roomId);
        if (!rooms.has(roomId)) {
            rooms.set(roomId, {
                id: roomId,
                players: [],
                status: 'waiting',
                gameState: null,
                host: socket.id
            });
        }
        const room = rooms.get(roomId);
        const player = { id: socket.id, username, deck: [] };
        room.players.push(player);
        io.to(roomId).emit('room_update', { room, isHost: room.host === socket.id });
    });

    socket.on('start_game', (roomId) => {
        const room = rooms.get(roomId);
        if (!room || room.host !== socket.id) return;

        const deck = createDeck();
        const cardsPerPlayer = Math.floor(100 / room.players.length);
        room.players.forEach((p, idx) => {
            p.deck = deck.slice(idx * cardsPerPlayer, (idx + 1) * cardsPerPlayer);
        });

        room.status = 'order_preview'; // New state to show order
        room.gameState = {
            currentTurn: 0,
            currentNumber: 1,
            direction: 1,
            lastCard: null,
            winner: null,
            subTurn: 0
        };

        io.to(roomId).emit('show_order', room);

        // Auto-start game after 5 seconds of order preview
        setTimeout(() => {
            room.status = 'playing';
            io.to(roomId).emit('game_started', room);
        }, 5000);
    });

    socket.on('play_card', ({ roomId, action }) => {
        const room = rooms.get(roomId);
        if (!room || room.status !== 'playing') return;

        const state = room.gameState;
        const currentPlayer = room.players[state.currentTurn];
        if (currentPlayer.id !== socket.id) return;

        const currentCard = currentPlayer.deck[0];
        let expectedAction = '';
        if (currentCard.type.startsWith('NORMAL')) expectedAction = state.currentNumber.toString();
        else if (currentCard.type.startsWith('PHONE')) expectedAction = 'hello';
        else if (currentCard.type.startsWith('GUN')) expectedAction = 'เงียบ';

        if (action === expectedAction) {
            state.lastCard = currentCard;
            currentPlayer.deck.shift();
            if (currentPlayer.deck.length === 0) {
                state.winner = currentPlayer.username;
                room.status = 'finished';
                io.to(roomId).emit('game_over', room);
                return;
            }
            state.subTurn++;
            const { next, nextDirection } = getNextCount(state.currentNumber, state.direction);
            state.currentNumber = next;
            state.direction = nextDirection;

            if (state.subTurn >= currentCard.count) {
                state.subTurn = 0;
                let nextTurn = (state.currentTurn + 1) % room.players.length;
                if (currentCard.skip) nextTurn = (nextTurn + 1) % room.players.length;
                state.currentTurn = nextTurn;
            }
            io.to(roomId).emit('update_game_state', room);
        } else {
            socket.emit('wrong_move');
        }
    });
});

const PORT = process.env.PORT || 3001;
// Route handlers for cleaner URLs
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/lobby', (req, res) => res.sendFile(path.join(__dirname, 'lobby.html')));
app.get('/game', (req, res) => res.sendFile(path.join(__dirname, 'game.html')));

server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
