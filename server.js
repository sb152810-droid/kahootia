/* ============================================================
   SunLorem: Школа-Табір 5 Клас — сервер (Railway / Render)
   Node.js + Express + Socket.io + гейміфікація
   ============================================================ */

'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1h',
    etag: true,
    fallthrough: true
}));

/* ============================================================
   МАГАЗИН: аватари, аксесуари, теми
   ============================================================ */
const SHOP = {
    avatars: [
        { id: 'a_cat',    emoji: '🐱',  name: 'Кіт-астронавт',  price: 0,   desc: 'Базовий кіт-космонавт' },
        { id: 'a_dog',    emoji: '🐶',  name: 'Песик-пілот',    price: 0,   desc: 'Вірний друг' },
        { id: 'a_fox',    emoji: '🦊',  name: 'Лисичка-хакер',  price: 0,   desc: 'Хитра і швидка' },
        { id: 'a_panda',  emoji: '🐼',  name: 'Панда-ніндзя',   price: 20,  desc: 'Майстер бамбука' },
        { id: 'a_koala',  emoji: '🐨',  name: 'Коала-мудрець',  price: 30,  desc: 'Спокій і рівновага' },
        { id: 'a_lion',   emoji: '🦁',  name: 'Лев-король',     price: 40,  desc: 'Володар савани' },
        { id: 'a_tiger',  emoji: '🐯',  name: 'Тигр-воїн',      price: 50,  desc: 'Сміливість і сила' },
        { id: 'a_unicorn',emoji: '🦄',  name: 'Єдиноріг',       price: 60,  desc: 'Магія та легенди' },
        { id: 'a_dragon', emoji: '🐉',  name: 'Кібер-дракон',   price: 100, desc: 'Легендарний захисник' },
        { id: 'a_robot',  emoji: '🤖',  name: 'Робот-геній',    price: 80,  desc: 'Штучний інтелект' },
        { id: 'a_alien',  emoji: '👽',  name: 'Прибулець',      price: 70,  desc: 'Гість із зірок' },
        { id: 'a_wizard', emoji: '🧙',  name: 'Маг',            price: 90,  desc: 'Володар заклять' },
        { id: 'a_ninja',  emoji: '🥷',  name: 'Ніндзя',         price: 85,  desc: 'Тінь серед тіней' },
        { id: 'a_super',  emoji: '🦸',  name: 'Супергерой',     price: 120, desc: 'Захисник міста' },
        { id: 'a_astro',  emoji: '👨‍🚀', name: 'Астронавт',      price: 110, desc: 'Підкорювач космосу' },
        { id: 'a_pirate', emoji: '🏴‍☠️', name: 'Пірат',          price: 75,  desc: 'Шукач скарбів' }
    ],
    accessories: [
        { id: 'x_none',      emoji: '',   name: 'Немає',         price: 0,   slot: 'head' },
        { id: 'x_crown',     emoji: '👑', name: 'Корона',        price: 50,  slot: 'head' },
        { id: 'x_hat',       emoji: '🎩', name: 'Циліндр',       price: 30,  slot: 'head' },
        { id: 'x_partyhat',  emoji: '🎉', name: 'Святковий ковпак', price: 20, slot: 'head' },
        { id: 'x_cap',       emoji: '🧢', name: 'Кепка',         price: 15,  slot: 'head' },
        { id: 'x_grad',      emoji: '🎓', name: 'Академічна шапочка', price: 40, slot: 'head' },
        { id: 'x_glasses',   emoji: '🕶️', name: 'Кібер-окуляри',  price: 25,  slot: 'eyes' },
        { id: 'x_goggles',   emoji: '🥽', name: 'Захисні окуляри', price: 35, slot: 'eyes' },
        { id: 'x_aura',      emoji: '✨', name: 'Сяйво',         price: 60,  slot: 'effect' },
        { id: 'x_fire',      emoji: '🔥', name: 'Полум\'я',      price: 70,  slot: 'effect' },
        { id: 'x_star',      emoji: '⭐', name: 'Зірки',         price: 45,  slot: 'effect' },
        { id: 'x_rainbow',   emoji: '🌈', name: 'Веселка',       price: 55,  slot: 'effect' },
        { id: 'x_lightning', emoji: '⚡', name: 'Блискавка',     price: 65,  slot: 'effect' },
        { id: 'x_heart',     emoji: '💖', name: 'Сердечка',      price: 40,  slot: 'effect' }
    ],
    themes: [
        { id: 't_neon',    name: 'Неон',          price: 0,   desc: 'Базовий неон' },
        { id: 't_pastel',  name: 'Пастель',       price: 0,   desc: 'Базовий пастель' },
        { id: 't_space',   name: 'Космос',        price: 80,  desc: 'Глибокий космос із зорями' },
        { id: 't_cyber',   name: 'Неон-кіберпанк',price: 100, desc: 'Агресивний неоновий стиль' },
        { id: 't_forest',  name: 'Магічний ліс',  price: 90,  desc: 'Затишний зелений ліс' },
        { id: 't_sunset',  name: 'Захід сонця',   price: 70,  desc: 'Теплі помаранчеві тони' },
        { id: 't_ocean',   name: 'Океан',         price: 85,  desc: 'Блакитні глибини' },
        { id: 't_candy',   name: 'Цукеркова',     price: 60,  desc: 'Рожева солодка тема' }
    ]
};

/* ============================================================
   БАЗА УКРАЇНСЬКИХ ІМЕН
   ============================================================ */
const FIRST_NAMES_M = [
    'Андрій','Артем','Арсен','Богдан','Борис','Вадим','Валентин','Валерій','Василь','Віктор',
    'Віталій','Владислав','Володимир','В\'ячеслав','Геннадій','Георгій','Григорій','Данило','Денис','Дмитро',
    'Євген','Єгор','Захар','Іван','Ігор','Ілля','Кирило','Костянтин','Леонід','Максим',
    'Марко','Микита','Микола','Мирон','Михайло','Назар','Нестор','Олег','Олександр','Олексій',
    'Остап','Павло','Петро','Роман','Ростислав','Руслан','Святослав','Сергій','Станіслав','Степан',
    'Тарас','Тимофій','Тимур','Устим','Юрій','Ярема','Ярослав','Яків','Лука','Левко'
];
const FIRST_NAMES_F = [
    'Аліна','Аліса','Анастасія','Ангеліна','Анна','Аріна','Богдана','Валерія','Вікторія','Віолетта',
    'Владислава','Дарина','Діана','Єва','Єлизавета','Злата','Іванна','Ірина','Каміла','Карина',
    'Катерина','Кіра','Ліліана','Ліза','Людмила','Марія','Марта','Мілана','Мілена','Надія',
    'Наталія','Ніка','Оксана','Олена','Ольга','Поліна','Роксолана','Соломія','Софія','Тамара',
    'Тетяна','Уляна','Христина','Юлія','Яна','Ярина','Ярослава','Амелія','Емілія','Зоряна'
];
const LAST_NAMES = [
    'Шевченко','Коваленко','Бондаренко','Ткаченко','Кравченко','Олійник','Шевчук','Поліщук','Бойко','Ковальчук',
    'Коваль','Мельник','Марченко','Лисенко','Руденко','Савченко','Петренко','Іваненко','Мороз','Левченко',
    'Козак','Гриценко','Даниленко','Науменко','Клименко','Панченко','Гаврилюк','Кучеренко','Литвиненко','Сидоренко',
    'Захарченко','Костенко','Романенко','Гончаренко','Дмитрук','Мельничук','Павленко','Приходько','Ткачук','Гнатюк',
    'Мазур','Хоменко','Юрченко','Пилипенко','Гуменюк','Слободян','Демченко','Ващенко','Білоус','Кравець'
];

const AVATARS = ['😀','😎','🤓','🥳','😺','🐶','🦊','🐼','🐨','🦁','🐯','🐸','🐵','🐧','🦄','🐙','🦖','🐉','🌟','⚡','🔥','🌈','🍀','🎈','🚀','🎨','🎮','⚽','🏆','💎','🍕','🍩'];

/* ============================================================
   РЕЖИМИ
   ============================================================ */
const MODES = {
    arcade:   { name: 'Аркада', multiplier: 1.0, defaultTime: 20 },
    survival: { name: 'Виживання', multiplier: 1.5, defaultTime: 15 },
    treasure: { name: 'Полювання на скарби', multiplier: 1.2, defaultTime: 25 }
};

/* ============================================================
   КІМНАТИ
   ============================================================ */
const rooms = new Map();

function generatePin() {
    for (let i = 0; i < 200; i++) {
        const pin = String(Math.floor(100000 + Math.random() * 900000));
        if (!rooms.has(pin)) return pin;
    }
    return String(Math.floor(100000 + Math.random() * 900000));
}

function makeId(prefix) {
    return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function generateBots(count) {
    const bots = [];
    const allFirst = FIRST_NAMES_M.concat(FIRST_NAMES_F);
    const poolFirst = allFirst.slice();
    const poolLast = LAST_NAMES.slice();
    const used = new Set();
    for (let i = 0; i < count; i++) {
        let first, last, full;
        let attempts = 0;
        do {
            first = poolFirst.length ? poolFirst.splice(Math.floor(Math.random()*poolFirst.length),1)[0]
                                     : allFirst[Math.floor(Math.random()*allFirst.length)];
            last  = poolLast.length  ? poolLast.splice(Math.floor(Math.random()*poolLast.length),1)[0]
                                     : LAST_NAMES[Math.floor(Math.random()*LAST_NAMES.length)];
            full = first + ' ' + last;
            attempts++;
        } while (used.has(full) && attempts < 80);
        used.add(full);
        bots.push({
            id: makeId('bot' + i),
            name: full,
            avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)],
            avatarId: 'a_cat',
            accessories: { head: '', eyes: '', effect: '' },
            score: 0,
            coins: 0,
            isBot: true,
            correctCount: 0,
            wrongCount: 0,
            alive: true,
            answeredThisRound: false,
            lastCorrect: null,
            botSpeed: 0.5 + Math.random() * 0.5,
            streak: 0,
            powerActive: null
        });
    }
    return bots;
}

function addFeed(room, text) {
    if (!room.feed) room.feed = [];
    room.feed.unshift({ text, t: Date.now() });
    if (room.feed.length > 40) room.feed.length = 40;
}

function getPublicState(room) {
    return {
        pin: room.pin,
        status: room.status,
        mode: room.mode,
        timePerQuestion: room.timePerQuestion,
        questions: room.questions,
        currentQuestion: room.currentQuestion,
        questionStartedAt: room.questionStartedAt,
        timeLeft: room.timeLeft,
        players: room.players.map(p => ({
            id: p.id,
            name: p.name,
            avatar: p.avatar,
            avatarId: p.avatarId,
            accessories: p.accessories,
            score: p.score,
            coins: p.coins,
            isBot: p.isBot,
            correctCount: p.correctCount,
            wrongCount: p.wrongCount,
            alive: p.alive,
            answeredThisRound: p.answeredThisRound,
            lastCorrect: p.lastCorrect,
            streak: p.streak || 0,
            powerActive: p.powerActive || null
        })),
        feed: room.feed || []
    };
}

function broadcastState(room) {
    io.to('room_' + room.pin).emit('state', getPublicState(room));
}

function stopTimer(room) {
    if (room.timer) { clearInterval(room.timer); room.timer = null; }
}

function startTimer(room) {
    stopTimer(room);
    room.questionStartedAt = Date.now();
    room.timeLeft = room.timePerQuestion;
    broadcastState(room);

    room.timer = setInterval(() => {
        const elapsed = (Date.now() - room.questionStartedAt) / 1000;
        const left = Math.max(0, room.timePerQuestion - elapsed);
        const leftInt = Math.ceil(left);
        room.timeLeft = leftInt;

        io.to('room_' + room.pin).emit('tick', {
            timeLeft: leftInt,
            questionIndex: room.currentQuestion,
            total: room.timePerQuestion
        });

        if (left <= 0) {
            stopTimer(room);
            io.to('room_' + room.pin).emit('timeExpired', { questionIndex: room.currentQuestion });
        }
    }, 250);
}

function scheduleBotAnswers(room) {
    const q = room.questions[room.currentQuestion];
    if (!q) return;
    const qIndex = room.currentQuestion;
    const qStart = room.questionStartedAt;

    room.players.forEach(p => {
        if (!p.isBot || !p.alive) return;
        const speed = p.botSpeed || 0.7;
        const delayMs = (0.2 + (1 - speed) * 0.7) * room.timePerQuestion * 1000;

        setTimeout(() => {
            if (room.status !== 'running') return;
            if (room.currentQuestion !== qIndex) return;
            if (room.questionStartedAt !== qStart) return;
            if (p.answeredThisRound) return;
            if (!room.players.includes(p)) return;

            p.answeredThisRound = true;
            const correctChance = 0.35 + speed * 0.5;
            const isCorrect = Math.random() < correctChance;
            p.lastCorrect = isCorrect;

            if (isCorrect) {
                p.correctCount++;
                p.streak = (p.streak || 0) + 1;
                const elapsed = (Date.now() - room.questionStartedAt) / 1000;
                const timeBonus = Math.round(Math.max(0, (1 - elapsed / room.timePerQuestion)) * 50);
                const mult = MODES[room.mode] ? MODES[room.mode].multiplier : 1.0;
                const powerMult = (p.powerActive && p.powerActive.type === 'double') ? 2 : 1;
                const gained = Math.round((100 + timeBonus) * mult * powerMult);
                p.score += gained;
                const coins = Math.round(gained / 5);
                p.coins = (p.coins || 0) + coins;
                addFeed(room, '🤖 ' + p.name + ' правильно (+' + gained + ' балів, +' + coins + ' 🪙)');
                // знімаємо активну силу
                p.powerActive = null;
            } else {
                p.wrongCount++;
                p.streak = 0;
                if (room.mode === 'survival' && p.wrongCount >= 3) {
                    p.alive = false;
                    addFeed(room, '💀 ' + p.name + ' вибуває (3 помилки)');
                }
            }
            broadcastState(room);
        }, delayMs);
    });
}

function cleanupRoom(room) {
    stopTimer(room);
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    if (room.teacherDisconnectTimer) clearTimeout(room.teacherDisconnectTimer);
}

/* ============================================================
   SOCKET.IO
   ============================================================ */
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'], credentials: false },
    transports: ['polling', 'websocket'],
    pingInterval: 25000,
    pingTimeout: 30000,
    maxHttpBufferSize: 5 * 1024 * 1024,
    path: '/socket.io/',
    allowEIO3: true
});

/* ============================================================
   API для магазину
   ============================================================ */
app.get('/api/shop', (req, res) => {
    res.json({ ok: true, shop: SHOP });
});

app.get('/health', (req, res) => {
    res.json({
        ok: true,
        rooms: rooms.size,
        uptime: Math.round(process.uptime()),
        node: process.version,
        now: Date.now()
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get(/^\/(?!socket\.io|api\/).*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ============================================================
   SOCKET.IO — ОБРОБНИКИ
   ============================================================ */
io.on('connection', (socket) => {
    console.log('[connect]', socket.id, '| transport:', socket.conn.transport.name);

    let currentRoomPin = null;
    let role = null;

    socket.conn.on('upgrade', () => {
        console.log('[upgrade]', socket.id, '→', socket.conn.transport.name);
    });

    /* ---------- МАГАЗИН ---------- */
    socket.on('getShop', (cb) => {
        if (cb) cb({ ok: true, shop: SHOP });
    });

    /* ---------- СТВОРЕННЯ КІМНАТИ ---------- */
    socket.on('createRoom', (payload, cb) => {
        try {
            const questions = (payload && Array.isArray(payload.questions)) ? payload.questions : [];
            if (questions.length === 0) { if (cb) cb({ ok: false, error: 'Немає питань' }); return; }
            const mode = (payload.mode && MODES[payload.mode]) ? payload.mode : 'arcade';
            const timePerQuestion = Math.max(5, Math.min(60,
                parseInt(payload.timePerQuestion, 10) || MODES[mode].defaultTime));
            const botCount = Math.max(0, Math.min(200, parseInt(payload.botCount, 10) || 0));

            const pin = generatePin();
            const bots = generateBots(botCount);

            const room = {
                pin,
                createdAt: Date.now(),
                status: 'lobby',
                mode,
                timePerQuestion,
                questions: questions.map(q => ({
                    text: String(q.text || '').slice(0, 300),
                    answers: (q.answers || []).map(a => String(a).slice(0, 100)).slice(0, 6),
                    correct: parseInt(q.correct, 10) || 0
                })),
                currentQuestion: -1,
                questionStartedAt: 0,
                timeLeft: timePerQuestion,
                players: bots,
                feed: [],
                teacherSocketId: socket.id,
                teacherPlayerId: 'teacher_' + pin,
                timer: null,
                cleanupTimer: null,
                teacherDisconnectTimer: null
            };

            rooms.set(pin, room);
            currentRoomPin = pin;
            role = 'teacher';
            socket.join('room_' + pin);
            addFeed(room, '🎉 Кімнату створено. Очікуємо на учнів...');
            console.log('[room] created', pin, '| bots:', botCount, '| q:', questions.length);

            if (cb) cb({ ok: true, pin, state: getPublicState(room) });
            broadcastState(room);
        } catch (err) {
            console.error('createRoom error', err);
            if (cb) cb({ ok: false, error: 'Помилка створення кімнати' });
        }
    });

    /* ---------- ПРИЄДНАННЯ ---------- */
    socket.on('joinRoom', (payload, cb) => {
        try {
            const pin = String((payload && payload.pin) || '').trim();
            const name = String((payload && payload.name) || '').trim().slice(0, 24);
            const avatarId = String((payload && payload.avatarId) || 'a_cat');
            const accessories = (payload && payload.accessories) || { head: '', eyes: '', effect: '' };
            const coins = Math.max(0, parseInt(payload && payload.coins, 10) || 0);

            if (!/^\d{6}$/.test(pin)) { if (cb) cb({ ok: false, error: 'Невірний PIN' }); return; }
            if (name.length < 2)      { if (cb) cb({ ok: false, error: 'Ім\'я закоротке' }); return; }

            const room = rooms.get(pin);
            if (!room) { if (cb) cb({ ok: false, error: 'Кімнату не знайдено' }); return; }
            if (room.status === 'finished') { if (cb) cb({ ok: false, error: 'Гра вже завершена' }); return; }

            // визначаємо емодзі аватара за id
            let avatarEmoji = '😀';
            const found = SHOP.avatars.find(a => a.id === avatarId);
            if (found) avatarEmoji = found.emoji;

            const existing = room.players.find(p => !p.isBot && p.name.toLowerCase() === name.toLowerCase());
            let player;

            if (existing) {
                existing.avatarId = avatarId;
                existing.avatar = avatarEmoji;
                existing.accessories = accessories;
                existing.coins = Math.max(existing.coins || 0, coins);
                existing.socketId = socket.id;
                player = existing;
                addFeed(room, '🔄 ' + name + ' повернувся');
            } else {
                player = {
                    id: makeId('pl'),
                    name,
                    avatar: avatarEmoji,
                    avatarId,
                    accessories,
                    score: 0,
                    coins,
                    isBot: false,
                    correctCount: 0,
                    wrongCount: 0,
                    alive: true,
                    answeredThisRound: false,
                    lastCorrect: null,
                    socketId: socket.id,
                    streak: 0,
                    powerActive: null
                };
                room.players.push(player);
                addFeed(room, '🎒 ' + name + ' приєднався до гри!');
            }

            currentRoomPin = pin;
            role = 'student';
            socket.join('room_' + pin);
            console.log('[room] join', pin, '| name:', name, '| total:', room.players.length);

            if (cb) cb({ ok: true, playerId: player.id, state: getPublicState(room) });
            broadcastState(room);
        } catch (err) {
            console.error('joinRoom error', err);
            if (cb) cb({ ok: false, error: 'Помилка входу' });
        }
    });

    /* ---------- ОНОВЛЕННЯ ПРОФІЛЮ (аватар/аксесуари) ---------- */
    socket.on('updateProfile', (payload, cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room) { if (cb) cb({ ok: false }); return; }
            const player = room.players.find(p => p.id === payload.playerId);
            if (!player) { if (cb) cb({ ok: false }); return; }

            const avatarId = String(payload.avatarId || player.avatarId || 'a_cat');
            const found = SHOP.avatars.find(a => a.id === avatarId);
            if (found) { player.avatarId = avatarId; player.avatar = found.emoji; }
            if (payload.accessories) player.accessories = payload.accessories;
            if (typeof payload.coins === 'number') player.coins = Math.max(player.coins, payload.coins);

            if (cb) cb({ ok: true });
            broadcastState(room);
        } catch (err) {
            if (cb) cb({ ok: false });
        }
    });

    /* ---------- АКТИВАЦІЯ СУПЕРСИЛИ ---------- */
    socket.on('activatePower', (payload, cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room || room.status !== 'running') { if (cb) cb({ ok: false, error: 'Гра не активна' }); return; }
            const player = room.players.find(p => p.id === payload.playerId);
            if (!player) { if (cb) cb({ ok: false }); return; }
            if ((player.streak || 0) < 3) { if (cb) cb({ ok: false, error: 'Потрібно 3 правильні поспіль' }); return; }
            if (player.powerActive) { if (cb) cb({ ok: false, error: 'Сила вже активна' }); return; }

            const type = String(payload.type || 'double');
            if (!['double','shield','reveal'].includes(type)) {
                if (cb) cb({ ok: false, error: 'Невідома сила' });
                return;
            }
            player.powerActive = { type, at: Date.now() };
            addFeed(room, '⚡ ' + player.name + ' активував суперсилу: ' + (
                type === 'double' ? 'Подвійні бали' :
                type === 'shield' ? 'Щит часу' : 'Підказка'
            ));

            // Ефект щита: +5 секунд
            if (type === 'shield') {
                room.questionStartedAt += 5000;
            }
            // Ефект підказки: миттєво виключає дві неправильні
            let hintIndexes = null;
            if (type === 'reveal') {
                const q = room.questions[room.currentQuestion];
                if (q) {
                    const wrong = [];
                    q.answers.forEach((_, i) => { if (i !== q.correct) wrong.push(i); });
                    wrong.sort(() => Math.random() - 0.5);
                    hintIndexes = wrong.slice(0, 2);
                }
            }

            if (cb) cb({ ok: true, type, hintIndexes });
            broadcastState(room);
        } catch (err) {
            console.error('activatePower error', err);
            if (cb) cb({ ok: false });
        }
    });

    /* ---------- ПОЧАТОК ГРИ ---------- */
    socket.on('startGame', (cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room || room.teacherSocketId !== socket.id) { if (cb) cb({ ok: false, error: 'Немає доступу' }); return; }
            if (room.status === 'running') { if (cb) cb({ ok: false, error: 'Гра вже триває' }); return; }
            if (room.questions.length === 0) { if (cb) cb({ ok: false, error: 'Немає питань' }); return; }

            room.status = 'running';
            room.currentQuestion = 0;
            room.feed = [];
            room.players.forEach(p => {
                p.answeredThisRound = false;
                p.lastCorrect = null;
                p.score = 0;
                p.correctCount = 0;
                p.wrongCount = 0;
                p.alive = true;
                p.streak = 0;
                p.powerActive = null;
            });
            addFeed(room, '🚀 Гру розпочато! Питання 1');
            stopTimer(room);
            startTimer(room);
            scheduleBotAnswers(room);

            if (cb) cb({ ok: true });
            broadcastState(room);
        } catch (err) {
            console.error('startGame error', err);
            if (cb) cb({ ok: false });
        }
    });

    /* ---------- НАСТУПНЕ ПИТАННЯ ---------- */
    socket.on('nextQuestion', (cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room || room.teacherSocketId !== socket.id) { if (cb) cb({ ok: false }); return; }
            if (room.status !== 'running') { if (cb) cb({ ok: false }); return; }
            if (room.currentQuestion + 1 >= room.questions.length) { if (cb) cb({ ok: false, error: 'Останнє питання' }); return; }

            room.currentQuestion++;
            room.players.forEach(p => { p.answeredThisRound = false; p.lastCorrect = null; });
            addFeed(room, '➡️ Питання ' + (room.currentQuestion + 1));
            stopTimer(room);
            startTimer(room);
            scheduleBotAnswers(room);

            if (cb) cb({ ok: true, questionIndex: room.currentQuestion });
            broadcastState(room);
        } catch (err) {
            if (cb) cb({ ok: false });
        }
    });

    /* ---------- ВІДПОВІДЬ УЧНЯ ---------- */
    socket.on('answer', (payload, cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room || room.status !== 'running') { if (cb) cb({ ok: false }); return; }

            const qIndex = parseInt(payload && payload.q, 10);
            const aIndex = parseInt(payload && payload.a, 10);
            const playerId = payload && payload.playerId;

            if (qIndex !== room.currentQuestion) { if (cb) cb({ ok: false, error: 'Застаріле питання' }); return
