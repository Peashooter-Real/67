/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 995:
/***/ ((module) => {

module.exports = eval("require")("cors");


/***/ }),

/***/ 300:
/***/ ((module) => {

module.exports = eval("require")("express");


/***/ }),

/***/ 547:
/***/ ((module) => {

module.exports = eval("require")("socket.io");


/***/ }),

/***/ 611:
/***/ ((module) => {

"use strict";
module.exports = require("http");

/***/ }),

/***/ 928:
/***/ ((module) => {

"use strict";
module.exports = require("path");

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __nccwpck_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			__webpack_modules__[moduleId](module, module.exports, __nccwpck_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete __webpack_module_cache__[moduleId];
/******/ 		}
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat */
/******/ 	
/******/ 	if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = __dirname + "/";
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
const express = __nccwpck_require__(300);
const http = __nccwpck_require__(611);
const { Server } = __nccwpck_require__(547);
const cors = __nccwpck_require__(995);
const path = __nccwpck_require__(928);

const app = express();
app.use(cors());
app.use(express.static(__dirname));
app.use('/assets', express.static(__nccwpck_require__.ab + "assets"));

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
        
        // Find if player already exists in this room
        let player = room.players.find(p => p.username === username);
        
        if (player) {
            // Update existing player with new socket ID
            const oldId = player.id;
            player.id = socket.id;
            // If they were host, update host ID
            if (room.host === oldId) room.host = socket.id;
        } else {
            // New player
            player = { id: socket.id, username, deck: [] };
            room.players.push(player);
            // First player is always host if not already set
            if (!room.host) room.host = socket.id;
        }

        // Send update to everyone
        io.to(roomId).emit('room_update', { 
            room, 
            isHost: room.host === socket.id 
        });

        // If game is already in progress, send the current state to the joining user
        if (room.status === 'playing' || room.status === 'finished') {
            socket.emit('update_game_state', room);
        }
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
            pendingCard: null, // Card currently revealed and waiting for action
            playedPile: [],
            winner: null,
            subTurn: 0
        };

        io.to(roomId).emit('show_order', room);

        // Auto-start game after 5 seconds of order preview
        setTimeout(() => {
            if (!room) return;
            room.status = 'playing';
            
            // Re-check first player and their deck
            const turnIndex = room.gameState.currentTurn;
            const firstPlayer = room.players[turnIndex];
            
            if (firstPlayer && firstPlayer.deck && firstPlayer.deck.length > 0) {
                room.gameState.pendingCard = firstPlayer.deck.shift();
            } else {
                console.log("Warning: First player deck is empty or undefined", firstPlayer);
            }
            
            io.to(roomId).emit('game_started', room);
            // Also emit update to ensure anyone already on game.html gets it
            io.to(roomId).emit('update_game_state', room);
        }, 5000);
    });

    socket.on('play_card', ({ roomId, action }) => {
        const room = rooms.get(roomId);
        if (!room || room.status !== 'playing') return;
        const state = room.gameState;
        
        const requester = room.players.find(p => p.id === socket.id);
        if (!requester || !state.pendingCard) return;

        const currentPlayer = room.players[state.currentTurn];
        if (currentPlayer.username !== requester.username) return;

        const currentCard = state.pendingCard;
        let expectedAction = '';
        if (currentCard.type.startsWith('NORMAL')) expectedAction = state.currentNumber.toString();
        else if (currentCard.type.startsWith('PHONE')) expectedAction = 'hello';
        else if (currentCard.type.startsWith('GUN')) expectedAction = 'เงียบ';

        if (action === expectedAction) {
            state.lastCard = currentCard;
            state.playedPile.push(currentCard);
            
            state.subTurn++;
            const { next, nextDirection } = getNextCount(state.currentNumber, state.direction);
            state.currentNumber = next;
            state.direction = nextDirection;

            // If card actions are complete (1 for single, 2 for double)
            if (state.subTurn >= currentCard.count) {
                state.subTurn = 0;
                state.pendingCard = null; // Clear revealed card

                if (currentPlayer.deck.length === 0) {
                    state.winner = currentPlayer.username;
                    room.status = 'finished';
                    io.to(roomId).emit('game_over', room);
                    return;
                }

                let nextTurn = (state.currentTurn + 1) % room.players.length;
                if (currentCard.skip) nextTurn = (nextTurn + 1) % room.players.length;
                state.currentTurn = nextTurn;

                // Auto-flip for next turn
                const nextPlayer = room.players[state.currentTurn];
                if (nextPlayer && nextPlayer.deck.length > 0) {
                    state.pendingCard = nextPlayer.deck.shift();
                }
            }
            io.to(roomId).emit('update_game_state', room);
        } else {
            // PENALTY
            const penaltyCards = state.playedPile.length + 1;
            currentPlayer.deck = shuffle([...currentPlayer.deck, ...state.playedPile, state.pendingCard]);
            state.playedPile = [];
            state.lastCard = null;
            state.pendingCard = null;
            state.subTurn = 0;
            
            state.currentTurn = (state.currentTurn + 1) % room.players.length;
            
            // Auto-flip for next turn after penalty
            const nextPlayerAfterPenalty = room.players[state.currentTurn];
            if (nextPlayerAfterPenalty && nextPlayerAfterPenalty.deck.length > 0) {
                state.pendingCard = nextPlayerAfterPenalty.deck.shift();
            }

            io.to(roomId).emit('penalty_given', { username: currentPlayer.username, count: penaltyCards });
            io.to(roomId).emit('update_game_state', room);
        }
    });
});

const PORT = process.env.PORT || 3001;
// Route handlers for cleaner URLs
app.get('/', (req, res) => res.sendFile(__nccwpck_require__.ab + "index.html"));
app.get('/lobby', (req, res) => res.sendFile(__nccwpck_require__.ab + "lobby.html"));
app.get('/game', (req, res) => res.sendFile(__nccwpck_require__.ab + "game.html"));

server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

module.exports = __webpack_exports__;
/******/ })()
;