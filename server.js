const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let rooms = {}; // roomCode: { players: [], history: [], turn: 0, currentWord: '' }
let dictionary = new Set(); // 단어 검증용 메모리 저장소

// 서버가 시작될 때 무료 오픈소스 한글 단어 데이터 불러오기
async function loadDictionary() {
    try {
        // 공공/오픈소스에 공개된 순우리말/국어 명사 JSON 데이터 URL
        const response = await fetch('https://raw.githubusercontent.com/username/repository/main/words.json');
        // 혹은 기본적으로 자주 쓰이는 단어들을 직접 Set에 넣을 수도 있습니다.
        const words = await response.json();
        dictionary = new Set(words);
        console.log(`단어장 로드 완료: ${dictionary.size}개의 단어`);
    } catch (error) {
        console.log('외부 단어장 로드 실패, 기본 필수 단어장으로 대체합니다.');
        // 네트워크 문제가 있거나 할 때를 대비한 기본 단어들
        const basicWords = [
            "기상", "상상", "상어", "어린이", "인형", "행복", "복숭아", "아파트", 
            "트럼프", "프라이", "이스터", "터널", "널뛰기", "기차", "차량", "량태"
        ];
        dictionary = new Set(basicWords);
    }
}

io.on('connection', (socket) => {
    console.log('사용자 접속:', socket.id);

    socket.on('join_room', (roomCode) => {
        if (!rooms[roomCode]) {
            rooms[roomCode] = { players: [], history: [], turn: 0, currentWord: '' };
        }

        let room = rooms[roomCode];
        if (room.players.length >= 2) {
            socket.emit('room_full');
            return;
        }

        room.players.push(socket.id);
        socket.join(roomCode);
        socket.roomCode = roomCode;

        io.to(roomCode).emit('room_update', {
            playerCount: room.players.length,
            history: room.history,
            currentWord: room.currentWord,
            turn: room.players[room.turn % room.players.length]
        });
    });

    socket.on('submit_word', (word) => {
        let roomCode = socket.roomCode;
        if (!roomCode || !rooms[roomCode]) return;
        let room = rooms[roomCode];

        let currentPlayer = room.players[room.turn % room.players.length];
        if (socket.id !== currentPlayer) {
            socket.emit('error_msg', '당신의 차례가 아닙니다!');
            return;
        }

        word = word.trim();

        // 순수 한글 2글자 이상인지 검증
        const koreanRegex = /^[가-힣]{2,}$/;
        if (!koreanRegex.test(word)) {
            socket.emit('error_msg', '2글자 이상의 한글만 입력할 수 있습니다!');
            return;
        }

        // 끝말잇기 규칙 검증
        if (room.history.length > 0) {
            let lastWord = room.history[room.history.length - 1];
            let lastChar = lastWord[lastWord.length - 1];
            let firstChar = word[0];

            if (lastChar !== firstChar) {
                socket.emit('error_msg', `'${lastChar}'(으)로 시작하는 단어를 입력해야 합니다!`);
                return;
            }
        }

        if (room.history.includes(word)) {
            socket.emit('error_msg', '이미 사용된 단어입니다!');
            return;
        }

        // 💡 단어장에 존재하는지 검사 (인증키 불필요)
        // 만약 자체 단어장에 없는 단어라면 차단
        if (dictionary.size > 0 && !dictionary.has(word)) {
            socket.emit('error_msg', '국어사전에 없는 단어이거나 등록되지 않은 단어입니다!');
            return;
        }

        // 성공 시 상태 업데이트
        room.history.push(word);
        room.currentWord = word;
        room.turn++;

        io.to(roomCode).emit('update_game', {
            history: room.history,
            currentWord: room.currentWord,
            turn: room.players[room.turn % room.players.length]
        });
    });

    socket.on('disconnect', () => {
        let roomCode = socket.roomCode;
        if (roomCode && rooms[roomCode]) {
            let room = rooms[roomCode];
            room.players = room.players.filter(id => id !== socket.id);
            if (room.players.length === 0) {
                delete rooms[roomCode];
            } else {
                io.to(roomCode).emit('player_left');
            }
        }
    });
});

// 서버 실행 전 단어장 로드
loadDictionary().then(() => {
    server.listen(3000, () => {
        console.log('서버 실행 중: http://localhost:3000');
    });
});
