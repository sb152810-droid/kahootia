/* ============================================================
   SunLorem: Школа-Табір 5 Клас — сервер (Railway / Render)
   Node.js + Express + Socket.io
   Збалансована економіка СанКоїнів + Квести + Колекції + Емодзі
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
   ЕКОНОМІКА — ЖОРСТКО ОБМЕЖЕНА
   ------------------------------------------------------------
   ПРАВИЛА:
   • За гру (відповіді) учень може отримати МАКСИМУМ 30 🪙
   • Внутрішньоігрові нагороди — мінімальні (1 монета + 1 за швидкість)
   • Основні призові нараховуються у ФІНАЛІ:
       1 місце  → 70 🪙
       2 місце  → 60 🪙
       3 місце  → 50 🪙
       4–5      → 25 🪙
       6–10     → 18 🪙
       решта    → 10 🪙
   • Максимум за гру: 30 (з відповідей) + 70 (призове) = 100 🪙
   ============================================================ */
const ECONOMY = {
    coinsCorrect: 1,
    coinsSpeedBonus: 1,
    coinsPerGameCap: 30,

    baseScore: 100,
    timeBonusMax: 50,
    streakScoreMultiplier: {
        3: 1.1,
        5: 1.2,
        7: 1.35,
        10: 1.5,
        15: 1.75
    },

    finalPrizes: {
        1: 70,
        2: 60,
        3: 50
    },
    finalTiers: [
        { minRank: 4,  maxRank: 5,    prize: 25 },
        { minRank: 6,  maxRank: 10,   prize: 18 },
        { minRank: 11, maxRank: 9999, prize: 10 }
    ]
};

function getFinalPrize(rank) {
    if (ECONOMY.finalPrizes[rank] !== undefined) return ECONOMY.finalPrizes[rank];
    for (const tier of ECONOMY.finalTiers) {
        if (rank >= tier.minRank && rank <= tier.maxRank) return tier.prize;
    }
    return 0;
}

/* ============================================================
   КВЕСТИ (фіксуються під час гри, нагороджуються окремо)
   ============================================================ */
const QUEST_DEFS = {
    first_correct: {
        id: 'first_correct',
        title: 'Перший крок',
        desc: 'Дай 1 правильну відповідь',
        goal: 1,
        reward: 30,
        icon: '🎯'
    },
    correct_3_streak: {
        id: 'correct_3_streak',
        title: 'Розігрів',
        desc: '3 правильні відповіді поспіль',
        goal: 3,
        reward: 40,
        icon: '🔥'
    },
    correct_5_streak: {
        id: 'correct_5_streak',
        title: 'У вогні',
        desc: '5 правильних відповідей поспіль',
        goal: 5,
        reward: 75,
        icon: '⚡'
    },
    correct_10_total: {
        id: 'correct_10_total',
        title: 'Ерудит',
        desc: '10 правильних відповідей за гру',
        goal: 10,
        reward: 60,
        icon: '🧠'
    },
    first_answer: {
        id: 'first_answer',
        title: 'Швидкий старт',
        desc: 'Дай першу відповідь у раунді',
        goal: 1,
        reward: 20,
        icon: '🚀'
    },
    speed_demon: {
        id: 'speed_demon',
        title: 'Блискавка',
        desc: 'Відповідай за 3 секунди',
        goal: 1,
        reward: 50,
        icon: '💨'
    },
    survivor: {
        id: 'survivor',
        title: 'Вижити!',
        desc: 'Правильно в режимі «Виживання»',
        goal: 1,
        reward: 35,
        icon: '🛡️'
    }
};

/* ============================================================
   МАГАЗИН: аватари, аксесуари, теми, колекції
   ============================================================ */
const SHOP = {
    collections: [
        { id: 'col_base',   name: 'Базова',            emoji: '🎒', desc: 'Стартовий набір',           bonus: 0 },
        { id: 'col_autumn', name: 'Осінній табір',     emoji: '🍂', desc: 'Атмосфера осені та багаття', bonus: 50 },
        { id: 'col_space',  name: 'Космічна експедиція', emoji: '🚀', desc: 'Підкорювачі зірок',         bonus: 70 },
        { id: 'col_cyber',  name: 'Кібер-табір',       emoji: '🤖', desc: 'Технології майбутнього',    bonus: 70 },
        { id: 'col_magic',  name: 'Магічний табір',    emoji: '🔮', desc: 'Чарівні створіння',         bonus: 80 },
        { id: 'col_super',  name: 'Супергерої',        emoji: '🦸', desc: 'Захисники табору',          bonus: 90 }
    ],
    avatars: [
        { id: 'a_cat',       emoji: '🐱',   name: 'Кіт-астронавт',    price: 0,   col: 'col_base',   desc: 'Базовий кіт-космонавт' },
        { id: 'a_dog',       emoji: '🐶',   name: 'Песик-пілот',      price: 0,   col: 'col_base',   desc: 'Вірний друг' },
        { id: 'a_fox',       emoji: '🦊',   name: 'Лисичка-хакер',    price: 0,   col: 'col_base',   desc: 'Хитра і швидка' },
        { id: 'a_owl',       emoji: '🦉',   name: 'Мудра сова',       price: 25,  col: 'col_autumn', desc: 'Символ знань' },
        { id: 'a_hedgehog',  emoji: '🦔',   name: 'Їжачок',           price: 30,  col: 'col_autumn', desc: 'Маленький колючий друг' },
        { id: 'a_squirrel',  emoji: '🐿️',  name: 'Білочка',          price: 35,  col: 'col_autumn', desc: 'Збирач горіхів' },
        { id: 'a_deer',      emoji: '🦌',   name: 'Олень',            price: 45,  col: 'col_autumn', desc: 'Лісовий володар' },
        { id: 'a_bear',      emoji: '🐻',   name: 'Ведмідь-таборянин',price: 55,  col: 'col_autumn', desc: 'Господар лісу' },
        { id: 'a_astronaut', emoji: '👨‍🚀',  name: 'Астронавт',        price: 60,  col: 'col_space',  desc: 'Підкорювач космосу' },
        { id: 'a_alien',     emoji: '👽',   name: 'Прибулець',        price: 55,  col: 'col_space',  desc: 'Гість із зірок' },
        { id: 'a_rocket',    emoji: '🚀',   name: 'Ракета',           price: 40,  col: 'col_space',  desc: 'Символ швидкості' },
        { id: 'a_comet',     emoji: '☄️',   name: 'Комета',           price: 65,  col: 'col_space',  desc: 'Космічний мандрівник' },
        { id: 'a_ufo',       emoji: '🛸',   name: 'НЛО',              price: 75,  col: 'col_space',  desc: 'Таємничий корабель' },
        { id: 'a_saturn',    emoji: '🪐',   name: 'Сатурн',           price: 85,  col: 'col_space',  desc: 'Планета з кільцями' },
        { id: 'a_robot',     emoji: '🤖',   name: 'Робот-геній',      price: 60,  col: 'col_cyber',  desc: 'Штучний інтелект' },
        { id: 'a_cyborg',    emoji: '🦾',   name: 'Кіборг',           price: 80,  col: 'col_cyber',  desc: 'Механічна рука' },
        { id: 'a_ninja',     emoji: '🥷',   name: 'Ніндзя',           price: 70,  col: 'col_cyber',  desc: 'Тінь серед тіней' },
        { id: 'a_dragon',    emoji: '🐉',   name: 'Кібер-дракон',     price: 110, col: 'col_cyber',  desc: 'Легендарний захисник' },
        { id: 'a_chip',      emoji: '💠',   name: 'Кристал-чип',      price: 90,  col: 'col_cyber',  desc: 'Джерело енергії' },
        { id: 'a_wizard',    emoji: '🧙',   name: 'Маг',              price: 80,  col: 'col_magic',  desc: 'Володар заклять' },
        { id: 'a_unicorn',   emoji: '🦄',   name: 'Єдиноріг',         price: 85,  col: 'col_magic',  desc: 'Магія та легенди' },
        { id: 'a_fairy',     emoji: '🧚',   name: 'Фея',              price: 95,  col: 'col_magic',  desc: 'Дух природи' },
        { id: 'a_genie',     emoji: '🧞',   name: 'Джин',             price: 105, col: 'col_magic',  desc: 'Виконавець бажань' },
        { id: 'a_phoenix',   emoji: '🔥',   name: 'Фенікс',           price: 130, col: 'col_magic',  desc: 'Вічно відроджується' },
        { id: 'a_super',     emoji: '🦸',   name: 'Супергерой',       price: 100, col: 'col_super',  desc: 'Захисник міста' },
        { id: 'a_hero_f',    emoji: '🦸‍♀️', name: 'Супергероїня',     price: 100, col: 'col_super',  desc: 'Смілива й сильна' },
        { id: 'a_bat',       emoji: '🦇',   name: 'Бетмен',           price: 120, col: 'col_super',  desc: 'Тіньовий лицар' },
        { id: 'a_spider',    emoji: '🕷️',  name: 'Людина-павук',     price: 115, col: 'col_super',  desc: 'Дружній сусід' },
        { id: 'a_shield',    emoji: '🛡️',  name: 'Капітан',          price: 110, col: 'col_super',  desc: 'Щит справедливості' },
        { id: 'a_lightning', emoji: '⚡',   name: 'Громовержець',      price: 140, col: 'col_super',  desc: 'Володар блискавок' }
    ],
    accessories: [
        { id: 'x_none',      emoji: '',   name: 'Немає',              price: 0,   slot: 'head' },
        { id: 'x_crown',     emoji: '👑', name: 'Корона',             price: 50,  slot: 'head' },
        { id: 'x_hat',       emoji: '🎩', name: 'Циліндр',            price: 30,  slot: 'head' },
        { id: 'x_partyhat',  emoji: '🎉', name: 'Святковий ковпак',   price: 20,  slot: 'head' },
        { id: 'x_cap',       emoji: '🧢', name: 'Кепка',              price: 15,  slot: 'head' },
        { id: 'x_grad',      emoji: '🎓', name: 'Академічна шапочка', price: 40,  slot: 'head' },
        { id: 'x_beanie',    emoji: '🧣', name: 'Осінній шарф',       price: 25,  slot: 'head' },
        { id: 'x_helmet',    emoji: '⛑️', name: 'Шолом',              price: 45,  slot: 'head' },
        { id: 'x_top_hat',   emoji: '🎩', name: 'Магістерський',      price: 55,  slot: 'head' },
        { id: 'x_glasses',   emoji: '🕶️', name: 'Кібер-окуляри',      price: 25,  slot: 'eyes' },
        { id: 'x_goggles',   emoji: '🥽', name: 'Захисні окуляри',    price: 35,  slot: 'eyes' },
        { id: 'x_monocle',   emoji: '🧐', name: 'Монокль',            price: 40,  slot: 'eyes' },
        { id: 'x_aura',      emoji: '✨', name: 'Сяйво',              price: 60,  slot: 'effect' },
        { id: 'x_fire',      emoji: '🔥', name: 'Полум\'я',           price: 70,  slot: 'effect' },
        { id: 'x_star',      emoji: '⭐', name: 'Зірки',              price: 45,  slot: 'effect' },
        { id: 'x_rainbow',   emoji: '🌈', name: 'Веселка',            price: 55,  slot: 'effect' },
        { id: 'x_lightning', emoji: '⚡', name: 'Блискавка',          price: 65,  slot: 'effect' },
        { id: 'x_heart',     emoji: '💖', name: 'Сердечка',           price: 40,  slot: 'effect' },
        { id: 'x_leaf',      emoji: '🍁', name: 'Осіннє листя',       price: 30,  slot: 'effect' },
        { id: 'x_snow',      emoji: '❄️', name: 'Сніжинки',           price: 35,  slot: 'effect' }
    ],
    themes: [
        { id: 't_neon',    name: 'Неон',           price: 0,   desc: 'Базовий неон' },
        { id: 't_pastel',  name: 'Пастель',        price: 0,   desc: 'Базовий пастель' },
        { id: 't_space',   name: 'Космос',         price: 100, desc: 'Глибокий космос із зорями' },
        { id: 't_cyber',   name: 'Неон-кіберпанк', price: 130, desc: 'Агресивний неоновий стиль' },
        { id: 't_forest',  name: 'Магічний ліс',   price: 110, desc: 'Затишний зелений ліс' },
        { id: 't_sunset',  name: 'Захід сонця',    price: 90,  desc: 'Теплі помаранчеві тони' },
        { id: 't_ocean',   name: 'Океан',          price: 105, desc: 'Блакитні глибини' },
        { id: 't_candy',   name: 'Цукеркова',      price: 80,  desc: 'Рожева солодка тема' },
        { id: 't_autumn',  name: 'Осінній табір',  price: 120, desc: 'Тепло багаття та листя' }
    ]
};

const REACTION_EMOJIS = ['🎉', '🔥', '👏', '🤔', '🚀', '😂', '😮', '💪', '❓', '💯'];

/* ============================================================
   УКРАЇНСЬКІ ІМЕНА
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
            first = poolFirst.length
                ? poolFirst.splice(Math.floor(Math.random() * poolFirst.length), 1)[0]
                : allFirst[Math.floor(Math.random() * allFirst.length)];
            last = poolLast.length
                ? poolLast.splice(Math.floor(Math.random() * poolLast.length), 1)[0]
                : LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
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
            coinsEarnedThisGame: 0,
            xp: 0,
            isBot: true,
            correctCount: 0,
            wrongCount: 0,
            alive: true,
            answeredThisRound: false,
            lastCorrect: null,
            botSpeed: 0.5 + Math.random() * 0.5,
            streak: 0,
            bestStreak: 0,
            powerActive: null,
            reaction: null,
            finalRank: 0,
            finalPrize: 0
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
            avatarId: p.avatarId,
            accessories: p.accessories,
            score: p.score,
            coins: p.coins,
            coinsEarnedThisGame: p.coinsEarnedThisGame || 0,
            xp: p.xp || 0,
            isBot: p.isBot,
            correctCount: p.correctCount,
            wrongCount: p.wrongCount,
            alive: p.alive,
            answeredThisRound: p.answeredThisRound,
            lastCorrect: p.lastCorrect,
            streak: p.streak || 0,
            bestStreak: p.bestStreak || 0,
            powerActive: p.powerActive || null,
            reaction: p.reaction || null,
            finalRank: p.finalRank || 0,
            finalPrize: p.finalPrize || 0
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

/* ============================================================
   РОЗРАХУНОК НАГОРОД
   ============================================================ */
function calculateRewards(opts) {
    const {
        elapsed,
        timePerQuestion,
        mode,
        streak,
        powerActive,
        coinsEarnedThisGame
    } = opts;

    const timeBonus = Math.round(
        Math.max(0, 1 - elapsed / timePerQuestion) * ECONOMY.timeBonusMax
    );
    const modeMult = MODES[mode] ? MODES[mode].multiplier : 1.0;

    let streakMultScore = 1.0;
    const scoreKeys = Object.keys(ECONOMY.streakScoreMultiplier).map(Number).sort((a, b) => b - a);
    for (const k of scoreKeys) {
        if (streak >= k) {
            streakMultScore = ECONOMY.streakScoreMultiplier[k];
            break;
        }
    }

    const powerMult = (powerActive && powerActive.type === 'double') ? 2 : 1;
    const gainedScore = Math.round(
        (ECONOMY.baseScore + timeBonus) * modeMult * streakMultScore * powerMult
    );

    let coins = ECONOMY.coinsCorrect;

    const speedRatio = elapsed / timePerQuestion;
    let speedBonus = 0;
    if (speedRatio <= 0.25) {
        speedBonus = ECONOMY.coinsSpeedBonus;
        coins += speedBonus;
    }

    const cap = ECONOMY.coinsPerGameCap;
    const alreadyEarned = coinsEarnedThisGame || 0;
    const remaining = Math.max(0, cap - alreadyEarned);
    if (coins > remaining) coins = remaining;

    const gainedXp = Math.round(gainedScore / 10);

    return {
        score: gainedScore,
        coins: coins,
        xp: gainedXp,
        breakdown: {
            timeBonus,
            modeMult,
            streakMultScore,
            speedBonus,
            powerMult,
            cap,
            alreadyEarned,
            remaining
        }
    };
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
                if (p.streak > (p.bestStreak || 0)) p.bestStreak = p.streak;

                const elapsed = (Date.now() - room.questionStartedAt) / 1000;
                const rewards = calculateRewards({
                    elapsed,
                    timePerQuestion: room.timePerQuestion,
                    mode: room.mode,
                    streak: p.streak,
                    powerActive: p.powerActive,
                    coinsEarnedThisGame: p.coinsEarnedThisGame || 0
                });

                p.score += rewards.score;
                p.coins = (p.coins || 0) + rewards.coins;
                p.coinsEarnedThisGame = (p.coinsEarnedThisGame || 0) + rewards.coins;
                p.xp = (p.xp || 0) + rewards.xp;

                addFeed(room, '🤖 ' + p.name + ' правильно (+' + rewards.score + ' балів, +' + rewards.coins + ' 🪙)');
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
   HTTP-СЕРВЕР + SOCKET.IO
   ============================================================ */
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
        credentials: false
    },
    transports: ['polling', 'websocket'],
    pingInterval: 25000,
    pingTimeout: 30000,
    maxHttpBufferSize: 5 * 1024 * 1024,
    path: '/socket.io/',
    allowEIO3: true
});

/* ============================================================
   REST API
   ============================================================ */
app.get('/api/shop', (req, res) => {
    res.json({
        ok: true,
        shop: SHOP,
        economy: ECONOMY,
        quests: QUEST_DEFS,
        reactions: REACTION_EMOJIS
    });
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
        if (cb) cb({
            ok: true,
            shop: SHOP,
            economy: ECONOMY,
            quests: QUEST_DEFS,
            reactions: REACTION_EMOJIS
        });
    });

    /* ---------- СТВОРЕННЯ КІМНАТИ ---------- */
    socket.on('createRoom', (payload, cb) => {
        try {
            const questions = (payload && Array.isArray(payload.questions)) ? payload.questions : [];
            if (questions.length === 0) {
                if (cb) cb({ ok: false, error: 'Немає питань' });
                return;
            }
            const mode = (payload.mode && MODES[payload.mode]) ? payload.mode : 'arcade';
            const timePerQuestion = Math.max(5, Math.min(60,
                parseInt(payload.timePerQuestion, 10) || MODES[mode].defaultTime));
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
                reactions: [],
                firstAnswer: null,
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

            if (cb) cb({ ok: true, pin: pin, state: getPublicState(room) });
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
            const xp = Math.max(0, parseInt(payload && payload.xp, 10) || 0);

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

            let avatarEmoji = '😀';
            const found = SHOP.avatars.find(a => a.id === avatarId);
            if (found) avatarEmoji = found.emoji;

            const existing = room.players.find(p => !p.isBot && p.name.toLowerCase() === name.toLowerCase());
            let player;

            if (existing) {
                existing.avatarId = avatarId;
                existing.avatar = avatarEmoji;
                existing.accessories = accessories;
                existing.xp = Math.max(existing.xp || 0, xp);
                existing.socketId = socket.id;
                player = existing;
                addFeed(room, '🔄 ' + name + ' повернувся');
            } else {
                player = {
                    id: makeId('pl'),
                    name: name,
                    avatar: avatarEmoji,
                    avatarId: avatarId,
                    accessories: accessories,
                    score: 0,
                    coins: 0,
                    coinsEarnedThisGame: 0,
                    xp: xp,
                    isBot: false,
                    correctCount: 0,
                    wrongCount: 0,
                    alive: true,
                    answeredThisRound: false,
                    lastCorrect: null,
                    socketId: socket.id,
                    streak: 0,
                    bestStreak: 0,
                    powerActive: null,
                    reaction: null,
                    quests: {},
                    finalRank: 0,
                    finalPrize: 0
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

    /* ---------- ОНОВЛЕННЯ ПРОФІЛЮ ---------- */
    socket.on('updateProfile', (payload, cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room) {
                if (cb) cb({ ok: false });
                return;
            }
            const player = room.players.find(p => p.id === payload.playerId);
            if (!player) {
                if (cb) cb({ ok: false });
                return;
            }

            const avatarId = String(payload.avatarId || player.avatarId || 'a_cat');
            const found = SHOP.avatars.find(a => a.id === avatarId);
            if (found) {
                player.avatarId = avatarId;
                player.avatar = found.emoji;
            }
            if (payload.accessories) player.accessories = payload.accessories;
            if (typeof payload.xp === 'number') {
                player.xp = Math.max(player.xp || 0, payload.xp);
            }

            if (cb) cb({ ok: true });
            broadcastState(room);
        } catch (err) {
            console.error('updateProfile error', err);
            if (cb) cb({ ok: false });
        }
    });

    /* ---------- АКТИВАЦІЯ СУПЕРСИЛИ ---------- */
    socket.on('activatePower', (payload, cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room || room.status !== 'running') {
                if (cb) cb({ ok: false, error: 'Гра не активна' });
                return;
            }
            const player = room.players.find(p => p.id === payload.playerId);
            if (!player) {
                if (cb) cb({ ok: false });
                return;
            }
            if ((player.streak || 0) < 3) {
                if (cb) cb({ ok: false, error: 'Потрібно 3 правильні поспіль' });
                return;
            }
            if (player.powerActive) {
                if (cb) cb({ ok: false, error: 'Сила вже активна' });
                return;
            }

            const type = String(payload.type || 'double');
            if (['double', 'shield', 'reveal'].indexOf(type) === -1) {
                if (cb) cb({ ok: false, error: 'Невідома сила' });
                return;
            }

            player.powerActive = { type: type, at: Date.now() };
            addFeed(room, '⚡ ' + player.name + ' активував суперсилу: ' + (
                type === 'double' ? 'Подвійні бали' :
                type === 'shield' ? 'Щит часу' : 'Підказка'
            ));

            if (type === 'shield') {
                room.questionStartedAt += 5000;
            }

            let hintIndexes = null;
            if (type === 'reveal') {
                const q = room.questions[room.currentQuestion];
                if (q) {
                    const wrong = [];
                    q.answers.forEach((_, i) => {
                        if (i !== q.correct) wrong.push(i);
                    });
                    wrong.sort(() => Math.random() - 0.5);
                    hintIndexes = wrong.slice(0, 2);
                }
            }

            if (cb) cb({ ok: true, type: type, hintIndexes: hintIndexes });
            broadcastState(room);
        } catch (err) {
            console.error('activatePower error', err);
            if (cb) cb({ ok: false });
        }
    });

    /* ---------- ЕМОДЗІ-РЕАКЦІЯ ---------- */
    socket.on('sendReaction', (payload, cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room) {
                if (cb) cb({ ok: false });
                return;
            }
            const player = room.players.find(p => p.id === payload.playerId);
            if (!player) {
                if (cb) cb({ ok: false });
                return;
            }
            const emoji = String(payload.emoji || '').slice(0, 4);
            if (REACTION_EMOJIS.indexOf(emoji) === -1) {
                if (cb) cb({ ok: false, error: 'Недоступна емодзі' });
                return;
            }

            player.reaction = { emoji: emoji, t: Date.now() };

            io.to('room_' + room.pin).emit('playerReaction', {
                playerId: player.id,
                playerName: player.name,
                emoji: emoji,
                t: Date.now()
            });

            if (cb) cb({ ok: true });

            setTimeout(() => {
                const r = rooms.get(room.pin);
                if (!r) return;
                const p = r.players.find(x => x.id === player.id);
                if (p && p.reaction && (Date.now() - p.reaction.t) > 2900) {
                    p.reaction = null;
                }
            }, 3200);
        } catch (err) {
            console.error('sendReaction error', err);
            if (cb) cb({ ok: false });
        }
    });

    /* ---------- КВЕСТИ ---------- */
    socket.on('completeQuest', (payload, cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room) {
                if (cb) cb({ ok: false });
                return;
            }
            const player = room.players.find(p => p.id === payload.playerId);
            if (!player) {
                if (cb) cb({ ok: false });
                return;
            }
            const questId = String(payload.questId || '');
            const def = QUEST_DEFS[questId];
            if (!def) {
                if (cb) cb({ ok: false, error: 'Невідомий квест' });
                return;
            }
            if (!player.quests) player.quests = {};
            if (player.quests[questId] && player.quests[questId].completed) {
                if (cb) cb({ ok: false, error: 'Вже виконано' });
                return;
            }

            player.quests[questId] = {
                completed: true,
                t: Date.now(),
                pendingReward: def.reward
            };
            addFeed(room, '🏆 ' + player.name + ' виконав квест «' + def.title + '» (нагорода після гри)');

            if (cb) cb({ ok: true, pendingReward: def.reward });
            broadcastState(room);
        } catch (err) {
            console.error('completeQuest error', err);
            if (cb) cb({ ok: false });
        }
    });

    /* ---------- ПОЧАТОК ГРИ ---------- */
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
            room.firstAnswer = null;
            room.players.forEach(p => {
                p.answeredThisRound = false;
                p.lastCorrect = null;
                p.score = 0;
                p.correctCount = 0;
                p.wrongCount = 0;
                p.alive = true;
                p.streak = 0;
                p.bestStreak = 0;
                p.powerActive = null;
                p.reaction = null;
                p.quests = {};
                p.coinsEarnedThisGame = 0;
                p.finalPrize = 0;
                p.finalRank = 0;
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
            if (!room || room.teacherSocketId !== socket.id) {
                if (cb) cb({ ok: false });
                return;
            }
            if (room.status !== 'running') {
                if (cb) cb({ ok: false });
                return;
            }
            if (room.currentQuestion + 1 >= room.questions.length) {
                if (cb) cb({ ok: false, error: 'Останнє питання' });
                return;
            }

            room.currentQuestion++;
            room.firstAnswer = null;
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
            if (cb) cb({ ok: false });
        }
    });

    /* ---------- ВІДПОВІДЬ УЧНЯ ---------- */
    socket.on('answer', (payload, cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room || room.status !== 'running') {
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
                if (cb) cb({ ok: false });
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
            if (!q) {
                if (cb) cb({ ok: false });
                return;
            }
            const isCorrect = (aIndex === q.correct);

            player.answeredThisRound = true;
            player.lastCorrect = isCorrect;

            const elapsed = (Date.now() - room.questionStartedAt) / 1000;

            if (!room.firstAnswer) {
                room.firstAnswer = player.id;
            }

            const completedQuests = [];

            if (isCorrect) {
                player.correctCount++;
                player.streak = (player.streak || 0) + 1;
                if (player.streak > (player.bestStreak || 0)) player.bestStreak = player.streak;

                const rewards = calculateRewards({
                    elapsed,
                    timePerQuestion: room.timePerQuestion,
                    mode: room.mode,
                    streak: player.streak,
                    powerActive: player.powerActive,
                    coinsEarnedThisGame: player.coinsEarnedThisGame || 0
                });

                player.score += rewards.score;
                player.coins = (player.coins || 0) + rewards.coins;
                player.coinsEarnedThisGame = (player.coinsEarnedThisGame || 0) + rewards.coins;
                player.xp = (player.xp || 0) + rewards.xp;

                let feedText = '✅ ' + player.name + ' правильно (+' + rewards.score + ' балів, +' + rewards.coins + ' 🪙)';
                if (rewards.breakdown.speedBonus > 0) {
                    feedText += ' ⚡';
                }
                if (rewards.breakdown.remaining === 0) {
                    feedText += ' [ліміт 🪙]';
                }
                addFeed(room, feedText);

                if (rewards.breakdown.powerMult === 2) {
                    addFeed(room, '⚡ Подвійні бали для ' + player.name);
                }

                if (!player.isBot) {
                    if (!player.quests) player.quests = {};
                    if (!player.quests.first_correct && player.correctCount >= 1) {
                        player.quests.first_correct = { completed: true, t: Date.now(), pendingReward: QUEST_DEFS.first_correct.reward };
                        completedQuests.push('first_correct');
                    }
                    if (!player.quests.correct_3_streak && player.streak >= 3) {
                        player.quests.correct_3_streak = { completed: true, t: Date.now(), pendingReward: QUEST_DEFS.correct_3_streak.reward };
                        completedQuests.push('correct_3_streak');
                    }
                    if (!player.quests.correct_5_streak && player.streak >= 5) {
                        player.quests.correct_5_streak = { completed: true, t: Date.now(), pendingReward: QUEST_DEFS.correct_5_streak.reward };
                        completedQuests.push('correct_5_streak');
                    }
                    if (!player.quests.correct_10_total && player.correctCount >= 10) {
                        player.quests.correct_10_total = { completed: true, t: Date.now(), pendingReward: QUEST_DEFS.correct_10_total.reward };
                        completedQuests.push('correct_10_total');
                    }
                    if (!player.quests.first_answer && room.firstAnswer === player.id) {
                        player.quests.first_answer = { completed: true, t: Date.now(), pendingReward: QUEST_DEFS.first_answer.reward };
                        completedQuests.push('first_answer');
                    }
                    if (!player.quests.speed_demon && elapsed <= 3) {
                        player.quests.speed_demon = { completed: true, t: Date.now(), pendingReward: QUEST_DEFS.speed_demon.reward };
                        completedQuests.push('speed_demon');
                    }
                    if (!player.quests.survivor && room.mode === 'survival') {
                        player.quests.survivor = { completed: true, t: Date.now(), pendingReward: QUEST_DEFS.survivor.reward };
                        completedQuests.push('survivor');
                    }
                }

                player.powerActive = null;
            } else {
                player.wrongCount++;
                player.streak = 0;
                addFeed(room, '❌ ' + player.name + ' помилився');
                if (room.mode === 'survival' && player.wrongCount >= 3) {
                    player.alive = false;
                    addFeed(room, '💀 ' + player.name + ' вибуває');
                }
            }

            if (cb) cb({
                ok: true,
                isCorrect: isCorrect,
                score: player.score,
                coins: player.coins,
                coinsEarnedThisGame: player.coinsEarnedThisGame || 0,
                coinsRemaining: Math.max(0, ECONOMY.coinsPerGameCap - (player.coinsEarnedThisGame || 0)),
                xp: player.xp,
                streak: player.streak,
                completedQuests: completedQuests
            });
            broadcastState(room);
        } catch (err) {
            console.error('answer error', err);
            if (cb) cb({ ok: false });
        }
    });

    /* ---------- ЗАВЕРШЕННЯ ГРИ ---------- */
    socket.on('finishGame', (cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room || room.teacherSocketId !== socket.id) {
                if (cb) cb({ ok: false });
                return;
            }
            stopTimer(room);
            room.status = 'finished';
            room.finishedAt = Date.now();

            const ranked = room.players.slice().sort((a, b) => b.score - a.score);

            ranked.forEach((p, idx) => {
                const rank = idx + 1;
                const prize = getFinalPrize(rank);
                p.finalRank = rank;
                p.finalPrize = prize;
                p.coins = (p.coins || 0) + prize;
            });

            addFeed(room, '🏁 Гру завершено!');
            if (ranked[0]) addFeed(room, '🥇 ' + ranked[0].name + ' — 1 місце (+' + getFinalPrize(1) + ' 🪙)');
            if (ranked[1]) addFeed(room, '🥈 ' + ranked[1].name + ' — 2 місце (+' + getFinalPrize(2) + ' 🪙)');
            if (ranked[2]) addFeed(room, '🥉 ' + ranked[2].name + ' — 3 місце (+' + getFinalPrize(3) + ' 🪙)');

            if (cb) cb({
                ok: true,
                finalPrizes: ranked.map(p => ({
                    id: p.id,
                    name: p.name,
                    rank: p.finalRank,
                    prize: p.finalPrize
                }))
            });
            broadcastState(room);
            io.to('room_' + room.pin).emit('gameOver');

            room.cleanupTimer = setTimeout(() => {
                const r = rooms.get(room.pin);
                if (r && r.status === 'finished') {
                    cleanupRoom(r);
                    rooms.delete(room.pin);
                }
            }, 15 * 60 * 1000);
        } catch (err) {
            console.error('finishGame error', err);
            if (cb) cb({ ok: false });
        }
    });

    /* ---------- ЗАКРИТТЯ КІМНАТИ ---------- */
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
            if (cb) cb({ ok: true });
        } catch (err) {
            console.error('closeRoom error', err);
            if (cb) cb({ ok: false });
        }
    });

    /* ---------- ПЕРЕВІРКА PIN ---------- */
    socket.on('checkPin', (payload, cb) => {
        try {
            const pin = String((payload && payload.pin) || '').trim();
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

    /* ---------- РЕКОНЕКТ ВЧИТЕЛЯ ---------- */
    socket.on('reconnectTeacher', (payload, cb) => {
        try {
            const pin = String((payload && payload.pin) || '').trim();
            const room = rooms.get(pin);
            if (!room) {
                if (cb) cb({ ok: false, error: 'Кімнату не знайдено' });
                return;
            }
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
            console.error('reconnectTeacher error', err);
            if (cb) cb({ ok: false });
        }
    });

    /* ---------- ВІД'ЄДНАННЯ ---------- */
    socket.on('disconnect', (reason) => {
        console.log('[disconnect]', socket.id, '| reason:', reason);
        const room = rooms.get(currentRoomPin);
        if (!room) return;

        if (role === 'teacher') {
            addFeed(room, '⚠️ Вчитель від\'єднався. Кімната закриється через 60 секунд...');
            broadcastState(room);
            room.teacherDisconnectTimer = setTimeout(() => {
                const r = rooms.get(room.pin);
                if (r && r.teacherSocketId === socket.id) {
                    io.to('room_' + r.pin).emit('roomClosed');
                    cleanupRoom(r);
                    rooms.delete(r.pin);
                    console.log('[room] closed after teacher disconnect', r.pin);
                }
            }, 60000);
        }

        if (role === 'student') {
            const player = room.players.find(p => p.socketId === socket.id);
            if (player) {
                player.socketId = null;
                player.answeredThisRound = false;
                setTimeout(() => {
                    if (rooms.has(room.pin)) broadcastState(room);
                }, 2000);
            }
        }
    });
});

/* ============================================================
   АВТООЧИЩЕННЯ КІМНАТ
   ============================================================ */
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [pin, room] of rooms) {
        const noHuman = room.players.filter(p => !p.isBot).length === 0;
        const oldLobby = noHuman && now - room.createdAt > 2 * 60 * 60 * 1000;
        const oldFinished = room.status === 'finished' &&
            room.finishedAt && now - room.finishedAt > 60 * 60 * 1000;
        if (oldLobby || oldFinished) {
            cleanupRoom(room);
            rooms.delete(pin);
            cleaned++;
        }
    }
    if (cleaned > 0) console.log('[cleanup] removed', cleaned, '| total:', rooms.size);
}, 5 * 60 * 1000);

/* ============================================================
   СТАРТ СЕРВЕРА — ДИНАМІЧНИЙ ПОРТ (Railway / Render)
   ============================================================ */
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

httpServer.listen(PORT, HOST, () => {
    console.log('==============================================');
    console.log('🌟 SunLorem: Школа-Табір 5 Клас');
    console.log('🚀 Сервер слухає на ' + HOST + ':' + PORT);
    console.log('🌐 NODE_ENV =', process.env.NODE_ENV || 'development');
    console.log('🔌 Socket.io path = /socket.io/');
    console.log('🛒 Магазин: /api/shop');
    console.log('⚙️  Стеля монет за гру: ' + ECONOMY.coinsPerGameCap);
    console.log('🏆 Призові: 1м=70, 2м=60, 3м=50, 4-5=25, 6-10=18, решта=10');
    console.log('🏆 Квестів у наборі: ' + Object.keys(QUEST_DEFS).length);
    console.log('🎭 Емодзі-реакцій: ' + REACTION_EMOJIS.length);
    console.log('==============================================');
});

/* ============================================================
   ГРАЦІЙНЕ ЗАВЕРШЕННЯ
   ============================================================ */
function gracefulShutdown(signal) {
    console.log('[shutdown]', signal);
    io.close(() => {
        httpServer.close(() => {
            console.log('[shutdown] closed');
            process.exit(0);
        });
    });
    setTimeout(() => process.exit(0), 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (err) => {
    console.error('[unhandledRejection]', err);
});
