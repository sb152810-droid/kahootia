/* ============================================================
   SunLorem: Школа-Табір 5 Клас — сервер
   Node.js + Express + Socket.io
   ============================================================ */

'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    },
    pingInterval: 20000,
    pingTimeout: 25000,
    maxHttpBufferSize: 5e6
});

/* ============================================================
   СТАТИКА
   ============================================================ */
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1h',
    etag: true
}));

app.get('/health', (req, res) => {
    res.json({
        ok: true,
        rooms: rooms.size,
        uptime: Math.round(process.uptime()),
        now: Date.now()
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ============================================================
   БАЗА УКРАЇНСЬКИХ ІМЕН ТА ПРІЗВИЩ
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
    'Коваль','Мельник','Ковальський','Марченко','Лисенко','Руденко','Савченко','Петренко','Іваненко','Мороз',
    'Левченко','Козак','Мельниченко','Гриценко','Даниленко','Науменко','Клименко','Панченко','Гаврилюк','Кучеренко',
    'Литвиненко','Сидоренко','Захарченко','Костенко','Романенко','Гончаренко','Дмитрук','Мельничук','Павленко','Приходько',
    'Ткачук','Гнатюк','Мазур','Хоменко','Юрченко','Пилипенко','Гуменюк','Слободян','Демченко','Ващенко',
    'Білоус','Кравець','Гончар','Матвієнко','Пономаренко','Різник','Тарасенко','Швець','Лукашенко','Черненко',
    'Федоренко','Яценко','Дяченко','Сорока','Головко','Опанасенко','Скиба','Пилипчук','Довженко','Мироненко',
    'Бабенко','Березовський','Вернигора','Гайдук','Гордієнко','Гребенюк','Дацюк','Євтушенко','Жук','Заєць',
    'Іващенко','Кириленко','Лебеденко','Малиновський','Нечипоренко','Овчаренко','Пасічник','Радченко','Семенюк','Тищенко',
    'Удовиченко','Федорчук','Харченко','Цимбалюк','Чорновіл','Шаповал','Юхименко','Ярошенко','Яковенко','Андрієнко'
];

const AVATARS = [
    '😀','😎','🤓','🥳','😺','🐶','🦊','🐼','🐨','🦁','🐯','🐸','🐵','🐧','🦄','🐙',
    '🦖','🐉','🌟','⚡','🔥','🌈','🍀','🎈','🚀','🎨','🎮','⚽','🏆','💎','🍕','🍩'
];

/* ============================================================
   ШАБЛОНИ ПИТАНЬ
   ============================================================ */
const TEMPLATES = {
    math: {
        name: 'Математика',
        questions: [
            { text: 'Скільки буде 7 × 8?', answers: ['54', '56', '48', '64'], correct: 1 },
            { text: 'Яке число є простим?', answers: ['9', '15', '17', '21'], correct: 2 },
            { text: 'Чому дорівнює 144 : 12?', answers: ['10', '11', '12', '14'], correct: 2 },
            { text: 'Скільки хвилин у 2,5 годинах?', answers: ['120', '135', '150', '180'], correct: 2 },
            { text: 'Яка площа квадрата зі стороною 9 см?', answers: ['18 см²', '36 см²', '81 см²', '90 см²'], correct: 2 },
            { text: 'Обчисли: 25 + 75 : 5', answers: ['20', '35', '40', '45'], correct: 2 },
            { text: 'Який дріб дорівнює 0,5?', answers: ['1/5', '1/2', '2/5', '5/10'], correct: 1 },
            { text: 'Скільки сторін має шестикутник?', answers: ['5', '6', '7', '8'], correct: 1 },
            { text: 'Яке число ділиться на 3?', answers: ['14', '22', '27', '31'], correct: 2 },
            { text: 'Скільки грамів у 3 кілограмах?', answers: ['30', '300', '3000', '30000'], correct: 2 }
        ]
    },
    ukrainian: {
        name: 'Українська мова',
        questions: [
            { text: 'Скільки букв в українському алфавіті?', answers: ['32', '33', '34', '35'], correct: 1 },
            { text: 'Яке слово написано правильно?', answers: ['проїзд', 'проезд', 'проїзд', 'проезд'], correct: 0 },
            { text: 'Іменник — це частина мови, яка означає:', answers: ['дію', 'предмет', 'ознаку', 'кількість'], correct: 1 },
            { text: 'Скільки голосних звуків в українській мові?', answers: ['5', '6', '7', '8'], correct: 1 },
            { text: 'Яке слово є дієсловом?', answers: ['швидкий', 'швидкість', 'швидко', 'швидшати'], correct: 3 },
            { text: 'Апостроф пишемо у слові:', answers: ['св..ято', 'п..ять', 'б..юро', 'цв..ях'], correct: 1 },
            { text: 'Прикметник відповідає на питання:', answers: ['хто? що?', 'який? чий?', 'що робити?', 'скільки?'], correct: 1 },
            { text: 'Яке слово — синонім до «гарний»?', answers: ['поганий', 'вродливий', 'сумний', 'старий'], correct: 1 },
            { text: 'М\'який знак пишемо у слові:', answers: ['міл..ярд', 'кін..', 'піс..ня', 'стіл..'], correct: 1 },
            { text: 'Речення за метою висловлювання бувають:', answers: ['прості й складні', 'розповідні, питальні, спонукальні', 'головні й другорядні', 'довгі й короткі'], correct: 1 }
        ]
    },
    history: {
        name: 'Історія України',
        questions: [
            { text: 'Хто був князем Київської Русі у 980–1015 рр.?', answers: ['Ярослав Мудрий', 'Володимир Великий', 'Святослав', 'Олег'], correct: 1 },
            { text: 'Коли відбулося хрещення Русі?', answers: ['862 р.', '988 р.', '1054 р.', '1240 р.'], correct: 1 },
            { text: 'Хто очолював козаків у XVII столітті?', answers: ['Богдан Хмельницький', 'Іван Мазепа', 'Петро Сагайдачний', 'Усі варіанти'], correct: 3 },
            { text: 'Яке місто є столицею України?', answers: ['Харків', 'Одеса', 'Київ', 'Львів'], correct: 2 },
            { text: 'Запорозька Січ розташовувалась на:', answers: ['Дністрі', 'Дніпрі', 'Дунаї', 'Доні'], correct: 1 },
            { text: 'Хто написав «Кобзар»?', answers: ['Іван Франко', 'Тарас Шевченко', 'Леся Українка', 'Григорій Сковорода'], correct: 1 },
            { text: 'Столиця УНР у 1918 році:', answers: ['Київ', 'Львів', 'Харків', 'Одеса'], correct: 0 },
            { text: 'Рік проголошення незалежності України:', answers: ['1989', '1990', '1991', '1992'], correct: 2 },
            { text: 'Козацька держава називалась:', answers: ['Гетьманщина', 'Королівство', 'Князівство', 'Республіка'], correct: 0 },
            { text: 'Хто очолив українське військо у 1648 році?', answers: ['Мазепа', 'Хмельницький', 'Дорошенко', 'Виговський'], correct: 1 }
        ]
    },
    nature: {
        name: 'Природознавство',
        questions: [
            { text: 'Який газ рослини вбирають із повітря?', answers: ['Кисень', 'Вуглекислий газ', 'Азот', 'Водень'], correct: 1 },
            { text: 'Скільки планет у Сонячній системі?', answers: ['7', '8', '9', '10'], correct: 1 },
            { text: 'Найбільший океан Землі:', answers: ['Атлантичний', 'Індійський', 'Тихий', 'Північний Льодовитий'], correct: 2 },
            { text: 'Яка тварина належить до ссавців?', answers: ['Дельфін', 'Акула', 'Окунь', 'Кит'], correct: 3 },
            { text: 'Скільки ніг у комахи?', answers: ['4', '6', '8', '10'], correct: 1 },
            { text: 'Що виробляють рослини на світлі?', answers: ['Крохмаль', 'Кисень', 'Цукор', 'Усе разом'], correct: 3 },
            { text: 'Найбільша планета Сонячної системи:', answers: ['Сатурн', 'Юпітер', 'Уран', 'Нептун'], correct: 1 },
            { text: 'Яка пора року йде після зими?', answers: ['Літо', 'Осінь', 'Весна', 'Зима'], correct: 2 },
            { text: 'Кров у тілі людини переносить:', answers: ['Кисень', 'Поживні речовини', 'Вуглекислий газ', 'Усе перелічене'], correct: 3 },
            { text: 'Вода замерзає при температурі:', answers: ['-10°C', '0°C', '+4°C', '+10°C'], correct: 1 }
        ]
    }
};

const MODES = {
    arcade: { name: 'Аркада', multiplier: 1.0, defaultTime: 20 },
    survival: { name: 'Виживання', multiplier: 1.5, defaultTime: 15 },
    treasure: { name: 'Полювання на скарби', multiplier: 1.2, defaultTime: 25 }
};

/* ============================================================
   КІМНАТИ
   ============================================================ */
const rooms = new Map();

function generatePin() {
    for (let attempt = 0; attempt < 100; attempt++) {
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
    const usedNames = new Set();

    for (let i = 0; i < count; i++) {
        let first, last, fullName;
        let attempts = 0;
        do {
            if (poolFirst.length === 0) {
                first = allFirst[Math.floor(Math.random() * allFirst.length)];
            } else {
                const idx = Math.floor(Math.random() * poolFirst.length);
                first = poolFirst.splice(idx, 1)[0];
            }
            if (poolLast.length === 0) {
                last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
            } else {
                const idx = Math.floor(Math.random() * poolLast.length);
                last = poolLast.splice(idx, 1)[0];
            }
            fullName = first + ' ' + last;
            attempts++;
        } while (usedNames.has(fullName) && attempts < 60);
        usedNames.add(fullName);

        bots.push({
            id: makeId('bot' + i),
            name: fullName,
            avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)],
            score: 0,
            isBot: true,
            correctCount: 0,
            wrongCount: 0,
            alive: true,
            answeredThisRound: false,
            lastCorrect: null,
            botSpeed: 0.5 + Math.random() * 0.5
        });
    }
    return bots;
}

function addFeed(room, text) {
    if (!room.feed) room.feed = [];
    room.feed.unshift({ text: text, t: Date.now() });
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
            score: p.score,
            isBot: p.isBot,
            correctCount: p.correctCount,
            wrongCount: p.wrongCount,
            alive: p.alive,
            answeredThisRound: p.answeredThisRound,
            lastCorrect: p.lastCorrect
        })),
        feed: room.feed || []
    };
}

function broadcastState(room) {
    io.to('room_' + room.pin).emit('state', getPublicState(room));
}

function stopTimer(room) {
    if (room.timer) {
        clearInterval(room.timer);
        room.timer = null;
    }
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
        const changed = leftInt !== room.timeLeft;
        room.timeLeft = leftInt;

        io.to('room_' + room.pin).emit('tick', {
            timeLeft: leftInt,
            questionIndex: room.currentQuestion,
            total: room.timePerQuestion
        });

        if (left <= 0) {
            stopTimer(room);
            io.to('room_' + room.pin).emit('timeExpired', {
                questionIndex: room.currentQuestion
            });
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
            // Перевірки валідності
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
                const elapsed = (Date.now() - room.questionStartedAt) / 1000;
                const timeBonus = Math.round(Math.max(0, (1 - elapsed / room.timePerQuestion)) * 50);
                const mult = MODES[room.mode] ? MODES[room.mode].multiplier : 1.0;
                const gained = Math.round((100 + timeBonus) * mult);
                p.score += gained;
                addFeed(room, '🤖 ' + p.name + ' правильно (+' + gained + ')');
            } else {
                p.wrongCount++;
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
}

/* ============================================================
   SOCKET.IO
   ============================================================ */
io.on('connection', (socket) => {
    console.log('[connect]', socket.id);

    let currentRoomPin = null;
    let role = null; // 'teacher' | 'student'

    /* ---------- СТВОРЕННЯ КІМНАТИ (вчитель) ---------- */
    socket.on('createRoom', (payload, cb) => {
        try {
            const questions = (payload && Array.isArray(payload.questions)) ? payload.questions : [];
            if (questions.length === 0) {
                if (cb) cb({ ok: false, error: 'Немає питань' });
                return;
            }
            const mode = (payload.mode && MODES[payload.mode]) ? payload.mode : 'arcade';
            const timePerQuestion = Math.max(5, Math.min(60, parseInt(payload.timePerQuestion, 10) || MODES[mode].defaultTime));
            const botCount = Math.max(0, Math.min(200, parseInt(payload.botCount, 10) || 0));

            const pin = generatePin();
            const bots = generateBots(botCount);

            const room = {
                pin: pin,
                createdAt: Date.now(),
                status: 'lobby',
                mode: mode,
                timePerQuestion: timePerQuestion,
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
                cleanupTimer: null
            };

            rooms.set(pin, room);
            currentRoomPin = pin;
            role = 'teacher';
            socket.join('room_' + pin);

            addFeed(room, '🎉 Кімнату створено. Очікуємо на учнів...');

            console.log('[room] created', pin, 'bots:', botCount);

            if (cb) cb({ ok: true, pin: pin, state: getPublicState(room) });
            broadcastState(room);
        } catch (err) {
            console.error('createRoom error', err);
            if (cb) cb({ ok: false, error: 'Помилка створення кімнати' });
        }
    });

    /* ---------- ПРИЄДНАННЯ УЧНЯ ---------- */
    socket.on('joinRoom', (payload, cb) => {
        try {
            const pin = String(payload && payload.pin || '').trim();
            const name = String(payload && payload.name || '').trim().slice(0, 24);
            const avatar = String(payload && payload.avatar || '😀').slice(0, 8);

            if (!/^\d{6}$/.test(pin)) {
                if (cb) cb({ ok: false, error: 'Невірний PIN' });
                return;
            }
            if (name.length < 2) {
                if (cb) cb({ ok: false, error: 'Ім\'я закоротке' });
                return;
            }

            const room = rooms.get(pin);
            if (!room) {
                if (cb) cb({ ok: false, error: 'Кімнату не знайдено' });
                return;
            }
            if (room.status === 'finished') {
                if (cb) cb({ ok: false, error: 'Гра вже завершена' });
                return;
            }

            // Перевірка на існуючого гравця з таким ім'ям
            const existing = room.players.find(p => !p.isBot && p.name.toLowerCase() === name.toLowerCase());
            let player;

            if (existing) {
                // Переприєднуємось під тим самим id (оновлюємо аватар)
                existing.avatar = avatar;
                existing.socketId = socket.id;
                player = existing;
            } else {
                player = {
                    id: 'pl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
                    name: name,
                    avatar: avatar,
                    score: 0,
                    isBot: false,
                    correctCount: 0,
                    wrongCount: 0,
                    alive: true,
                    answeredThisRound: false,
                    lastCorrect: null,
                    socketId: socket.id
                };
                room.players.push(player);
                addFeed(room, '🎒 ' + name + ' приєднався до гри!');
            }

            currentRoomPin = pin;
            role = 'student';
            socket.join('room_' + pin);

            console.log('[room] join', pin, name, 'players:', room.players.length);

            if (cb) cb({
                ok: true,
                playerId: player.id,
                state: getPublicState(room)
            });
            broadcastState(room);
        } catch (err) {
            console.error('joinRoom error', err);
            if (cb) cb({ ok: false, error: 'Помилка входу' });
        }
    });

    /* ---------- ПОЧАТОК ГРИ (вчитель) ---------- */
    socket.on('startGame', (cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room || room.teacherSocketId !== socket.id) {
                if (cb) cb({ ok: false, error: 'Немає доступу' });
                return;
            }
            if (room.status === 'running') {
                if (cb) cb({ ok: false, error: 'Гра вже триває' });
                return;
            }
            if (room.questions.length === 0) {
                if (cb) cb({ ok: false, error: 'Немає питань' });
                return;
            }

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
            });
            addFeed(room, '🚀 Гру розпочато! Питання 1');

            stopTimer(room);
            startTimer(room);
            scheduleBotAnswers(room);

            if (cb) cb({ ok: true });
            broadcastState(room);
        } catch (err) {
            console.error('startGame error', err);
            if (cb) cb({ ok: false, error: 'Помилка' });
        }
    });

    /* ---------- НАСТУПНЕ ПИТАННЯ (вчитель, кнопка «Продовжити») ---------- */
    socket.on('nextQuestion', (cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room || room.teacherSocketId !== socket.id) {
                if (cb) cb({ ok: false, error: 'Немає доступу' });
                return;
            }
            if (room.status !== 'running') {
                if (cb) cb({ ok: false, error: 'Гра не активна' });
                return;
            }
            if (room.currentQuestion + 1 >= room.questions.length) {
                if (cb) cb({ ok: false, error: 'Це було останнє питання' });
                return;
            }

            room.currentQuestion++;
            room.players.forEach(p => {
                p.answeredThisRound = false;
                p.lastCorrect = null;
            });
            addFeed(room, '➡️ Питання ' + (room.currentQuestion + 1));

            stopTimer(room);
            startTimer(room);
            scheduleBotAnswers(room);

            if (cb) cb({ ok: true, questionIndex: room.currentQuestion });
            broadcastState(room);
        } catch (err) {
            console.error('nextQuestion error', err);
            if (cb) cb({ ok: false, error: 'Помилка' });
        }
    });

    /* ---------- ВІДПОВІДЬ УЧНЯ ---------- */
    socket.on('answer', (payload, cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room) {
                if (cb) cb({ ok: false });
                return;
            }
            if (room.status !== 'running') {
                if (cb) cb({ ok: false });
                return;
            }
            const qIndex = parseInt(payload && payload.q, 10);
            const aIndex = parseInt(payload && payload.a, 10);
            const playerId = payload && payload.playerId;

            if (qIndex !== room.currentQuestion) {
                if (cb) cb({ ok: false, error: 'Застаріле питання' });
                return;
            }

            const player = room.players.find(p => p.id === playerId);
            if (!player) {
                if (cb) cb({ ok: false, error: 'Гравця не знайдено' });
                return;
            }
            if (player.answeredThisRound) {
                if (cb) cb({ ok: false, error: 'Вже відповіли' });
                return;
            }
            if (!player.alive) {
                if (cb) cb({ ok: false, error: 'Ви вибули' });
                return;
            }

            const q = room.questions[room.currentQuestion];
            if (!q) { if (cb) cb({ ok: false }); return; }
            const isCorrect = (aIndex === q.correct);

            player.answeredThisRound = true;
            player.lastCorrect = isCorrect;

            const elapsed = (Date.now() - room.questionStartedAt) / 1000;
            const mult = MODES[room.mode] ? MODES[room.mode].multiplier : 1.0;

            if (isCorrect) {
                player.correctCount++;
                const basePoints = 100;
                const timeBonus = Math.round(Math.max(0, (1 - elapsed / room.timePerQuestion)) * 50);
                const gained = Math.round((basePoints + timeBonus) * mult);
                player.score += gained;
                addFeed(room, '✅ ' + player.name + ' правильно (+' + gained + ')');
            } else {
                player.wrongCount++;
                addFeed(room, '❌ ' + player.name + ' помилився');
                if (room.mode === 'survival' && player.wrongCount >= 3) {
                    player.alive = false;
                    addFeed(room, '💀 ' + player.name + ' вибуває');
                }
            }

            if (cb) cb({ ok: true, isCorrect: isCorrect, score: player.score });
            broadcastState(room);
        } catch (err) {
            console.error('answer error', err);
            if (cb) cb({ ok: false });
        }
    });

    /* ---------- ЗАВЕРШЕННЯ ГРИ (вчитель) ---------- */
    socket.on('finishGame', (cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room || room.teacherSocketId !== socket.id) {
                if (cb) cb({ ok: false, error: 'Немає доступу' });
                return;
            }
            stopTimer(room);
            room.status = 'finished';
            room.finishedAt = Date.now();
            addFeed(room, '🏁 Гру завершено!');

            if (cb) cb({ ok: true });
            broadcastState(room);
            io.to('room_' + room.pin).emit('gameOver');

            // Автоочищення через 15 хвилин
            room.cleanupTimer = setTimeout(() => {
                if (rooms.has(room.pin) && rooms.get(room.pin).status === 'finished') {
                    cleanupRoom(room);
                    rooms.delete(room.pin);
                    console.log('[room] auto-deleted', room.pin);
                }
            }, 15 * 60 * 1000);
        } catch (err) {
            console.error('finishGame error', err);
            if (cb) cb({ ok: false });
        }
    });

    /* ---------- ЗАКРИТТЯ КІМНАТИ (вчитель) ---------- */
    socket.on('closeRoom', (cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room || room.teacherSocketId !== socket.id) {
                if (cb) cb({ ok: false });
                return;
            }
            io.to('room_' + room.pin).emit('roomClosed');
            cleanupRoom(room);
            rooms.delete(room.pin);
            console.log('[room] closed', room.pin);
            if (cb) cb({ ok: true });
        } catch (err) {
            console.error('closeRoom error', err);
            if (cb) cb({ ok: false });
        }
    });

    /* ---------- ПЕРЕВІРКА PIN ---------- */
    socket.on('checkPin', (payload, cb) => {
        try {
            const pin = String(payload && payload.pin || '').trim();
            const room = rooms.get(pin);
            if (cb) cb({
                ok: !!(room && room.status !== 'finished'),
                exists: !!room,
                status: room ? room.status : null
            });
        } catch (err) {
            if (cb) cb({ ok: false });
        }
    });

    /* ---------- ВІД'ЄДНАННЯ ---------- */
    socket.on('disconnect', () => {
        console.log('[disconnect]', socket.id);
        const room = rooms.get(currentRoomPin);
        if (!room) return;

        if (role === 'teacher') {
            // Вчитель пішов — закриваємо кімнату через 60 секунд, якщо не повернеться
            addFeed(room, '⚠️ Вчитель від\'єднався. Кімната закриється через 60 секунд...');
            broadcastState(room);
            room.teacherDisconnectTimer = setTimeout(() => {
                if (rooms.has(room.pin) && room.teacherSocketId === socket.id) {
                    io.to('room_' + room.pin).emit('roomClosed');
                    cleanupRoom(room);
                    rooms.delete(room.pin);
                    console.log('[room] closed after teacher disconnect', room.pin);
                }
            }, 60000);
        }

        if (role === 'student') {
            // Позначаємо учня як офлайн, але не видаляємо
            const player = room.players.find(p => p.socketId === socket.id);
            if (player) {
                player.socketId = null;
                player.answeredThisRound = false;
                // Оновлюємо статус через 2 секунди — раптом це короткий розрив
                setTimeout(() => {
                    if (rooms.has(room.pin)) {
                        broadcastState(room);
                    }
                }, 2000);
            }
        }
    });

    /* ---------- РЕКОНЕКТ ВЧИТЕЛЯ ---------- */
    socket.on('reconnectTeacher', (payload, cb) => {
        try {
            const pin = String(payload && payload.pin || '').trim();
            const room = rooms.get(pin);
            if (!room) {
                if (cb) cb({ ok: false, error: 'Кімнату не знайдено' });
                return;
            }
            // Очищаємо таймер відключення
            if (room.teacherDisconnectTimer) {
                clearTimeout(room.teacherDisconnectTimer);
                room.teacherDisconnectTimer = null;
            }
            room.teacherSocketId = socket.id;
            currentRoomPin = pin;
            role = 'teacher';
            socket.join('room_' + pin);
            addFeed(room, '✅ Вчитель повернувся');
            if (cb) cb({ ok: true, state: getPublicState(room) });
            broadcastState(room);
        } catch (err) {
            if (cb) cb({ ok: false });
        }
    });
});

/* ============================================================
   СТАРТ СЕРВЕРА
   ============================================================ */
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log('==============================================');
    console.log('🌟 SunLorem: Школа-Табір 5 Клас');
    console.log('🚀 Сервер запущено на порту ' + PORT);
    console.log('🌐 http://localhost:' + PORT);
    console.log('==============================================');
});

// Періодичне прибирання порожніх кімнат
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [pin, room] of rooms) {
        // Кімната без гравців старша за 2 години
        if (room.players.length === 0 && now - room.createdAt > 2 * 60 * 60 * 1000) {
            cleanupRoom(room);
            rooms.delete(pin);
            cleaned++;
        }
        // Завершені кімнати старші за 1 годину
        if (room.status === 'finished' && room.finishedAt && now - room.finishedAt > 60 * 60 * 1000) {
            cleanupRoom(room);
            rooms.delete(pin);
            cleaned++;
        }
    }
    if (cleaned > 0) console.log('[cleanup] removed', cleaned, 'rooms; total:', rooms.size);
}, 5 * 60 * 1000);
