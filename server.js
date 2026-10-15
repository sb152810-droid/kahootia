'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', etag: true, fallthrough: true }));

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB = {
    users: {}, quizzes: {}, games: [],
    homework: {}, grades: {}, analytics: {},
    marks: {}, points: {}, coinsLog: {}
};

const DAILY_COIN_CAP = 100;
const DEFAULT_SUBJECTS = ['Математика', 'Українська мова', 'Історія', 'Природознавство', 'Інше'];

function loadJSON(file, fallback) {
    const p = path.join(DATA_DIR, file);
    try {
        if (!fs.existsSync(p)) return fallback;
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
        console.error('[db] load error', file, e.message);
        return fallback;
    }
}
function saveJSON(file, data) {
    const p = path.join(DATA_DIR, file);
    try {
        fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error('[db] save error', file, e.message);
    }
}
function loadDB() {
    DB.users = loadJSON('users.json', {});
    DB.quizzes = loadJSON('quizzes.json', {});
    DB.games = loadJSON('games.json', []);
    DB.homework = loadJSON('homework.json', {});
    DB.grades = loadJSON('grades.json', {});
    DB.analytics = loadJSON('analytics.json', {});
    DB.marks = loadJSON('marks.json', {});
    DB.points = loadJSON('points.json', {});
    DB.coinsLog = loadJSON('coins_log.json', {});
    console.log('[db] users:', Object.keys(DB.users).length,
        '| quizzes:', Object.keys(DB.quizzes).length,
        '| homework:', Object.keys(DB.homework).length);
}
function saveUsers()     { saveJSON('users.json', DB.users); }
function saveQuizzes()   { saveJSON('quizzes.json', DB.quizzes); }
function saveGames()     { saveJSON('games.json', DB.games); }
function saveHomework()  { saveJSON('homework.json', DB.homework); }
function saveGrades()    { saveJSON('grades.json', DB.grades); }
function saveAnalytics() { saveJSON('analytics.json', DB.analytics); }
function saveMarks()     { saveJSON('marks.json', DB.marks); }
function savePoints()    { saveJSON('points.json', DB.points); }
function saveCoinsLog()  { saveJSON('coins_log.json', DB.coinsLog); }

function makeId(prefix) { return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8); }
function makePin() {
    for (let i = 0; i < 200; i++) {
        const pin = String(Math.floor(100000 + Math.random() * 900000));
        if (!rooms.has(pin)) return pin;
    }
    return String(Math.floor(100000 + Math.random() * 900000));
}
function hashPassword(pw) { return crypto.createHash('sha256').update('sunlorem_salt_' + pw).digest('hex'); }
function verifyPassword(pw, hash) { return hashPassword(pw) === hash; }
function getLevelFromXp(xp) { return Math.min(50, Math.floor((xp || 0) / 100) + 1); }
function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}
function autoGrade(percent) {
    if (percent >= 90) return 12;
    if (percent >= 80) return 11;
    if (percent >= 70) return 10;
    if (percent >= 65) return 9;
    if (percent >= 60) return 8;
    if (percent >= 55) return 7;
    if (percent >= 50) return 6;
    if (percent >= 45) return 5;
    if (percent >= 40) return 4;
    if (percent >= 35) return 3;
    if (percent >= 25) return 2;
    return 1;
}

function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function dateKey(ts) {
    const d = new Date(ts);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function getTodayCoins(login) {
    const list = DB.coinsLog[login] || [];
    const key = todayKey();
    return list.filter(c => dateKey(c.at) === key).reduce((s, c) => s + (c.value > 0 ? c.value : 0), 0);
}
function logCoins(login, value, reason) {
    if (!DB.coinsLog[login]) DB.coinsLog[login] = [];
    DB.coinsLog[login].unshift({
        id: makeId('cn'),
        value: parseInt(value, 10) || 0,
        reason: String(reason || '').slice(0, 200),
        at: Date.now()
    });
    if (DB.coinsLog[login].length > 500) DB.coinsLog[login].length = 500;
    saveCoinsLog();
}
function addCoinsWithCap(login, value, reason) {
    const u = DB.users[login];
    if (!u) return { ok: false };
    if (value <= 0) {
        u.coins = Math.max(0, (u.coins || 0) + value);
        saveUsers();
        return { ok: true, added: value };
    }
    const today = getTodayCoins(login);
    if (today >= DAILY_COIN_CAP) return { ok: false, skipped: value };
    let allowed = value;
    const remaining = DAILY_COIN_CAP - today;
    if (allowed > remaining) allowed = remaining;
    if (allowed <= 0) return { ok: false, skipped: value };
    u.coins = (u.coins || 0) + allowed;
    logCoins(login, allowed, reason);
    saveUsers();
    return { ok: true, added: allowed };
}
function subtractCoins(login, value, reason) {
    const u = DB.users[login];
    if (!u) return;
    u.coins = Math.max(0, (u.coins || 0) - value);
    logCoins(login, -value, reason);
    saveUsers();
}

/* ============================================================
   ЕКОНОМІКА
   ============================================================ */
const ECONOMY = {
    coinsCorrect: 1,
    soloGameCap: 5,
    multiGameCap: 5,
    duelWin: 10,
    duelLose: 10,
    baseScore: 100,
    timeBonusMax: 50,
    streakScoreMultiplier: { 3: 1.1, 5: 1.2, 7: 1.35, 10: 1.5, 15: 1.75 },
    finalPrizes: { 1: 30, 2: 20, 3: 10, other: 5 }
};
function getFinalPrize(rank) {
    if (rank === 1) return ECONOMY.finalPrizes[1];
    if (rank === 2) return ECONOMY.finalPrizes[2];
    if (rank === 3) return ECONOMY.finalPrizes[3];
    return ECONOMY.finalPrizes.other;
}

const QUEST_DEFS = {
    first_correct:    { id: 'first_correct',    title: 'Перший крок',   desc: 'Дай 1 правильну',  reward: 30, icon: '🎯' },
    correct_3_streak: { id: 'correct_3_streak', title: 'Розігрів',      desc: '3 поспіль',        reward: 40, icon: '🔥' },
    correct_5_streak: { id: 'correct_5_streak', title: 'У вогні',       desc: '5 поспіль',        reward: 75, icon: '⚡' },
    correct_10_total: { id: 'correct_10_total', title: 'Ерудит',        desc: '10 правильних',    reward: 60, icon: '🧠' },
    first_answer:     { id: 'first_answer',     title: 'Швидкий старт', desc: 'Перша відповідь',  reward: 20, icon: '🚀' },
    speed_demon:      { id: 'speed_demon',      title: 'Блискавка',     desc: 'За 3 секунди',     reward: 50, icon: '💨' },
    survivor:         { id: 'survivor',         title: 'Вижити!',       desc: 'Дожити до кінця',  reward: 35, icon: '🛡️' },
    change_theme:     { id: 'change_theme',     title: 'Стиліст',       desc: 'Зміни тему',       reward: 25, icon: '🎨' }
};

/* ============================================================
   SHOP
   ============================================================ */
const SHOP = {
    collections: [
        { id: 'col_base', name: 'Базова', emoji: '😊', bonus: 0 },
        { id: 'col_autumn', name: 'Осінь', emoji: '🍂', bonus: 150 },
        { id: 'col_space', name: 'Космос', emoji: '🚀', bonus: 210 },
        { id: 'col_cyber', name: 'Кібер', emoji: '🤖', bonus: 210 },
        { id: 'col_magic', name: 'Магія', emoji: '🔮', bonus: 240 },
        { id: 'col_super', name: 'Супергерої', emoji: '🦸', bonus: 270 }
    ],
    avatars: [
        { id: 'a_smile', emoji: '😶', name: 'Смайлик', price: 0, col: 'col_base' },
        { id: 'a_grin', emoji: '😀', name: 'Усмішка', price: 0, col: 'col_base' },
        { id: 'a_cool', emoji: '😎', name: 'Крутий', price: 0, col: 'col_base' },
        { id: 'a_cat', emoji: '🐱', name: 'Кіт', price: 135, col: 'col_base' },
        { id: 'a_dog', emoji: '🐶', name: 'Пес', price: 135, col: 'col_base' },
        { id: 'a_fox', emoji: '🦊', name: 'Лис', price: 150, col: 'col_base' },
        { id: 'a_owl', emoji: '🦉', name: 'Сова', price: 180, col: 'col_autumn' },
        { id: 'a_hedgehog', emoji: '🦔', name: 'Їжак', price: 195, col: 'col_autumn' },
        { id: 'a_squirrel', emoji: '🐿️', name: 'Білка', price: 210, col: 'col_autumn' },
        { id: 'a_deer', emoji: '🦌', name: 'Олень', price: 270, col: 'col_autumn' },
        { id: 'a_bear', emoji: '🐻', name: 'Ведмідь', price: 330, col: 'col_autumn' },
        { id: 'a_astronaut', emoji: '👨‍🚀', name: 'Астронавт', price: 360, col: 'col_space' },
        { id: 'a_alien', emoji: '👽', name: 'Прибулець', price: 330, col: 'col_space' },
        { id: 'a_rocket', emoji: '🚀', name: 'Ракета', price: 240, col: 'col_space' },
        { id: 'a_comet', emoji: '☄️', name: 'Комета', price: 390, col: 'col_space' },
        { id: 'a_ufo', emoji: '🛸', name: 'НЛО', price: 450, col: 'col_space' },
        { id: 'a_saturn', emoji: '🪐', name: 'Сатурн', price: 510, col: 'col_space' },
        { id: 'a_robot', emoji: '🤖', name: 'Робот', price: 360, col: 'col_cyber' },
        { id: 'a_cyborg', emoji: '🦾', name: 'Кіборг', price: 480, col: 'col_cyber' },
        { id: 'a_ninja', emoji: '🥷', name: 'Ніндзя', price: 420, col: 'col_cyber' },
        { id: 'a_dragon', emoji: '🐉', name: 'Дракон', price: 660, col: 'col_cyber' },
        { id: 'a_chip', emoji: '💠', name: 'Чип', price: 540, col: 'col_cyber' },
        { id: 'a_wizard', emoji: '🧙', name: 'Маг', price: 480, col: 'col_magic' },
        { id: 'a_unicorn', emoji: '🦄', name: 'Єдиноріг', price: 510, col: 'col_magic' },
        { id: 'a_fairy', emoji: '🧚', name: 'Фея', price: 570, col: 'col_magic' },
        { id: 'a_genie', emoji: '🧞', name: 'Джин', price: 630, col: 'col_magic' },
        { id: 'a_phoenix', emoji: '🔥', name: 'Фенікс', price: 780, col: 'col_magic' },
        { id: 'a_super', emoji: '🦸', name: 'Герой', price: 600, col: 'col_super' },
        { id: 'a_hero_f', emoji: '🦸‍♀️', name: 'Героїня', price: 600, col: 'col_super' },
        { id: 'a_bat', emoji: '🦇', name: 'Бетмен', price: 720, col: 'col_super' },
        { id: 'a_spider', emoji: '🕷️', name: 'Павук', price: 690, col: 'col_super' },
        { id: 'a_shield', emoji: '🛡️', name: 'Капітан', price: 660, col: 'col_super' },
        { id: 'a_lightning', emoji: '⚡', name: 'Громовержець', price: 840, col: 'col_super' }
    ],
    accessories: [
        { id: 'x_crown', emoji: '👑', name: 'Корона', price: 300, slot: 'head' },
        { id: 'x_hat', emoji: '👒', name: 'Капелюшок', price: 180, slot: 'head' },
        { id: 'x_partyhat', emoji: '🎉', name: 'Ковпак', price: 120, slot: 'head' },
        { id: 'x_cap', emoji: '🧢', name: 'Кепка', price: 90, slot: 'head' },
        { id: 'x_grad', emoji: '🎓', name: 'Шапочка', price: 240, slot: 'head' },
        { id: 'x_beanie', emoji: '🧣', name: 'Шарф', price: 150, slot: 'head' },
        { id: 'x_helmet', emoji: '⛑️', name: 'Шолом', price: 270, slot: 'head' },
        { id: 'x_top_hat', emoji: '🎩', name: 'Циліндр', price: 330, slot: 'head' },
        { id: 'x_glasses', emoji: '🕶️', name: 'Окуляри', price: 150, slot: 'eyes' },
        { id: 'x_goggles', emoji: '🥽', name: 'Захисні', price: 210, slot: 'eyes' },
        { id: 'x_monocle', emoji: '🧐', name: 'Монокль', price: 240, slot: 'eyes' },
        { id: 'x_aura', emoji: '✨', name: 'Сяйво', price: 360, slot: 'effect' },
        { id: 'x_fire', emoji: '🔥', name: 'Полум\'я', price: 420, slot: 'effect' },
        { id: 'x_star', emoji: '⭐', name: 'Зірки', price: 270, slot: 'effect' },
        { id: 'x_rainbow', emoji: '🌈', name: 'Веселка', price: 330, slot: 'effect' },
        { id: 'x_lightning', emoji: '⚡', name: 'Блискавка', price: 390, slot: 'effect' },
        { id: 'x_heart', emoji: '💖', name: 'Сердечка', price: 240, slot: 'effect' },
        { id: 'x_leaf', emoji: '🍁', name: 'Листя', price: 180, slot: 'effect' },
        { id: 'x_snow', emoji: '❄️', name: 'Сніжинки', price: 210, slot: 'effect' }
    ],
    themes: [
        { id: 't_neon', name: 'Неон', price: 0, desc: 'Базовий' },
        { id: 't_pastel', name: 'Пастель', price: 0, desc: 'Базовий' },
        { id: 't_space', name: 'Космос', price: 600, desc: 'Зорі' },
        { id: 't_cyber', name: 'Кіберпанк', price: 780, desc: 'Неон' },
        { id: 't_forest', name: 'Ліс', price: 660, desc: 'Зелений' },
        { id: 't_sunset', name: 'Захід', price: 540, desc: 'Теплий' },
        { id: 't_ocean', name: 'Океан', price: 630, desc: 'Блакитний' },
        { id: 't_candy', name: 'Цукеркова', price: 480, desc: 'Рожева' },
        { id: 't_autumn', name: 'Осінь', price: 720, desc: 'Баграна' }
    ]
};

const REACTION_EMOJIS = ['🎉', '🔥', '👏', '🤔', '🚀', '😂', '😮', '💪', '❓', '💯'];
const CHAT_PHRASES = ['Вау!', 'Я знаю!', 'Дай шанс', 'Клас!', 'Ой…', 'Складно', 'Перемога!', 'Ще раз'];
const BOT_PHRASES = ['Ой, я забув формулу', 'Це було легко!', 'Дай підказку', 'Я майже!', 'Хтось знає?', 'Класне питання', 'Хм… складне', 'Я готовий!'];
const BOT_HW_COMMENTS = {
    good: ['Легко було!', 'Я готувався 💪', 'Класні питання!', ''],
    ok:   ['Трохи складнувато', 'Помилився двічі', 'Норм, але можна краще', ''],
    bad:  ['Ой, я забув формулу', 'Не встиг підготуватись', 'Було важко', '']
};

const FIRST_NAMES_M = ['Андрій','Артем','Арсен','Богдан','Борис','Вадим','Валентин','Валерій','Василь','Віктор','Віталій','Владислав','Володимир','Геннадій','Георгій','Григорій','Данило','Денис','Дмитро','Євген','Єгор','Захар','Іван','Ігор','Ілля','Кирило','Костянтин','Леонід','Максим','Марко','Микита','Микола','Мирон','Михайло','Назар','Нестор','Олег','Олександр','Олексій'];
const FIRST_NAMES_F = ['Аліна','Аліса','Анастасія','Ангеліна','Анна','Аріна','Богдана','Валерія','Вікторія','Віолетта','Владислава','Дарина','Діана','Єва','Єлизавета','Злата','Іванна','Ірина','Каміла','Карина','Катерина','Кіра','Ліліана','Ліза','Людмила','Марія','Марта','Мілана','Мілена','Надія'];
const LAST_NAMES = ['Шевченко','Коваленко','Бондаренко','Ткаченко','Кравченко','Олійник','Шевчук','Поліщук','Бойко','Ковальчук','Коваль','Мельник','Марченко','Лисенко','Руденко','Савченко','Петренко','Іваненко','Мороз','Левченко','Козак','Гриценко','Даниленко','Науменко','Клименко','Панченко','Гаврилюк','Кучеренко','Литвиненко','Сидоренко'];
const AVATARS_BOT = ['😀','😎','🤓','🥳','😺','🐶','🦊','🐼','🐨','🦁','🐯','🐸','🐵','🐧','🦄','🐙','🦖','🐉','🌟','⚡','🔥','🌈','🍀','🎈','🚀','🎨','🎮','⚽','🏆','💎'];

const MODES = {
    arcade:   { name: 'Аркада',    multiplier: 1.0, defaultTime: 20 },
    survival: { name: 'Виживання', multiplier: 1.5, defaultTime: 15 },
    treasure: { name: 'Скарби',    multiplier: 1.2, defaultTime: 25 }
};

const rateLimits = new Map();
function checkRateLimit(ip, max = 60) {
    const now = Date.now();
    let e = rateLimits.get(ip);
    if (!e || now > e.resetAt) {
        e = { count: 0, resetAt: now + 60000 };
        rateLimits.set(ip, e);
    }
    e.count++;
    return e.count <= max;
}

function ensureDefaultTeacher() {
    const login = 'місс.стівенс';
    if (!DB.users[login]) {
        DB.users[login] = {
            login, password: '102938', role: 'teacher', name: 'Місс.Стівенс',
            coins: 0, xp: 0, avatar: '👩‍🏫', avatarId: 'a_smile',
            ownedAvatars: ['a_smile', 'a_grin', 'a_cool'],
            ownedAccessories: [],
            ownedThemes: ['t_neon', 't_pastel'], theme: 'neon',
            completedQuests: {}, classStudents: [],
            subjects: DEFAULT_SUBJECTS.slice(),
            createdAt: Date.now()
        };
        saveUsers();
    } else if (!DB.users[login].subjects) {
        DB.users[login].subjects = DEFAULT_SUBJECTS.slice();
        saveUsers();
    }
}

function ensureDefaultQuizzes() {
    if (Object.keys(DB.quizzes).length > 0) return;
    const authorLogin = 'місс.стівенс';
    const author = 'Місс.Стівенс';
    const defaults = [
        {
            title: 'Математика 5 клас', subject: 'Математика', difficulty: 'medium',
            questions: [
                { text: 'Скільки буде 7 × 8?', answers: ['54', '56', '48', '64'], correct: 1 },
                { text: 'Яке число є простим?', answers: ['9', '15', '17', '21'], correct: 2 },
                { text: 'Чому дорівнює 144 : 12?', answers: ['10', '11', '12', '14'], correct: 2 },
                { text: 'Скільки хвилин у 2,5 годинах?', answers: ['120', '135', '150', '180'], correct: 2 },
                { text: 'Площа квадрата зі стороною 9 см?', answers: ['18 см²', '36 см²', '81 см²', '90 см²'], correct: 2 },
                { text: 'Обчисли: 25 + 75 : 5', answers: ['20', '35', '40', '45'], correct: 2 },
                { text: 'Який дріб дорівнює 0,5?', answers: ['1/5', '1/2', '2/5', '5/10'], correct: 1 },
                { text: 'Скільки сторін має шестикутник?', answers: ['5', '6', '7', '8'], correct: 1 },
                { text: 'Яке число ділиться на 3?', answers: ['14', '22', '27', '31'], correct: 2 },
                { text: 'Скільки грамів у 3 кілограмах?', answers: ['30', '300', '3000', '30000'], correct: 2 }
            ]
        },
        {
            title: 'Українська мова', subject: 'Українська мова', difficulty: 'medium',
            questions: [
                { text: 'Скільки букв в українському алфавіті?', answers: ['32', '33', '34', '35'], correct: 1 },
                { text: 'Яке слово написано правильно?', answers: ['проїзд', 'проезд', 'пройізд', 'пройзд'], correct: 0 },
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
        {
            title: 'Історія України', subject: 'Історія', difficulty: 'medium',
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
        {
            title: 'Природознавство', subject: 'Природознавство', difficulty: 'easy',
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
        },
        {
            title: 'Географія світу', subject: 'Інше', difficulty: 'medium',
            questions: [
                { text: 'Найвища гора світу?', answers: ['Ельбрус', 'Еверест', 'Кіліманджаро', 'Монблан'], correct: 1 },
                { text: 'Найдовша річка світу?', answers: ['Амазонка', 'Ніл', 'Янцзи', 'Міссісіпі'], correct: 1 },
                { text: 'Столиця Франції?', answers: ['Лондон', 'Берлін', 'Париж', 'Мадрид'], correct: 2 },
                { text: 'Найбільша країна світу за площею?', answers: ['Китай', 'США', 'Канада', 'Росія'], correct: 3 },
                { text: 'Який материк найменший?', answers: ['Європа', 'Антарктида', 'Австралія', 'Південна Америка'], correct: 2 },
                { text: 'Столиця Японії?', answers: ['Пекін', 'Сеул', 'Токіо', 'Бангкок'], correct: 2 },
                { text: 'Найбільше озеро світу?', answers: ['Байкал', 'Каспійське море', 'Вікторія', 'Верхнє'], correct: 1 },
                { text: 'Який океан найменший?', answers: ['Тихий', 'Атлантичний', 'Індійський', 'Північний Льодовитий'], correct: 3 },
                { text: 'Столиця Єгипту?', answers: ['Каїр', 'Александрія', 'Луксор', 'Асуан'], correct: 0 },
                { text: 'Найбільша пустеля світу?', answers: ['Сахара', 'Гобі', 'Калахарі', 'Атакама'], correct: 0 }
            ]
        },
        {
            title: 'Література', subject: 'Інше', difficulty: 'medium',
            questions: [
                { text: 'Хто автор «Кобзаря»?', answers: ['Франко', 'Шевченко', 'Леся Українка', 'Сковорода'], correct: 1 },
                { text: 'Хто написав «Лісову пісню»?', answers: ['Шевченко', 'Франко', 'Леся Українка', 'Коцюбинський'], correct: 2 },
                { text: 'Головний герой «Енеїди»?', answers: ['Тарас', 'Еней', 'Козак', 'Князь'], correct: 1 },
                { text: 'Хто автор «Захара Беркута»?', answers: ['Франко', 'Шевченко', 'Коцюбинський', 'Стельмах'], correct: 0 },
                { text: 'Хто написав казку «Рукавичка»?', answers: ['Народ', 'Шевченко', 'Франко', 'Леся'], correct: 0 },
                { text: 'Як звати дівчинку з казки «Попелюшка»?', answers: ['Попелюшка', 'Білосніжка', 'Рапунцель', 'Аріель'], correct: 0 },
                { text: 'Хто автор байки «Вовк та Ягня»?', answers: ['Крилов', 'Глібов', 'Езоп', 'Лафонтен'], correct: 1 },
                { text: 'Як звати чарівника з «Гаррі Поттера»?', answers: ['Дамблдор', 'Снейп', 'Волдеморт', 'Гаррі'], correct: 0 },
                { text: 'Хто автор «Мойсея»?', answers: ['Шевченко', 'Франко', 'Леся', 'Стус'], correct: 1 },
                { text: 'Кобзар — це:', answers: ['Народний співець', 'Письменник', 'Козак', 'Князь'], correct: 0 }
            ]
        },
        {
            title: 'Англійська мова — Basic', subject: 'Інше', difficulty: 'easy',
            questions: [
                { text: 'Як перекладається "cat"?', answers: ['Пес', 'Кіт', 'Птах', 'Риба'], correct: 1 },
                { text: 'Скільки букв в англійському алфавіті?', answers: ['24', '25', '26', '27'], correct: 2 },
                { text: 'Як сказати "привіт"?', answers: ['Goodbye', 'Hello', 'Thanks', 'Sorry'], correct: 1 },
                { text: '"Book" — це...', answers: ['Ручка', 'Книга', 'Стіл', 'Вікно'], correct: 1 },
                { text: 'Як сказати "дякую"?', answers: ['Please', 'Sorry', 'Thank you', 'Hello'], correct: 2 },
                { text: '"Red" — який колір?', answers: ['Синій', 'Зелений', 'Червоний', 'Жовтий'], correct: 2 },
                { text: 'Як сказати "один"?', answers: ['Two', 'One', 'Three', 'Four'], correct: 1 },
                { text: '"Mother" — це...', answers: ['Батько', 'Мати', 'Брат', 'Сестра'], correct: 1 },
                { text: 'Як сказати "до побачення"?', answers: ['Hello', 'Goodbye', 'Please', 'Yes'], correct: 1 },
                { text: '"School" — це...', answers: ['Дім', 'Школа', 'Магазин', 'Парк'], correct: 1 }
            ]
        },
        {
            title: 'Логіка та кмітливість', subject: 'Інше', difficulty: 'hard',
            questions: [
                { text: 'Продовж: 2, 4, 8, 16, ...', answers: ['24', '32', '20', '18'], correct: 1 },
                { text: 'Скільки буде 100 - 10 × 5?', answers: ['450', '50', '90', '500'], correct: 1 },
                { text: 'Якщо 5 машин за 5 хв роблять 5 деталей, скільки зробить 1 машина за 5 хв?', answers: ['1', '5', '25', '0.2'], correct: 0 },
                { text: 'Продовж: 1, 1, 2, 3, 5, 8, ...', answers: ['11', '13', '12', '15'], correct: 1 },
                { text: 'Що важче: 1 кг пір\'я чи 1 кг заліза?', answers: ['Пір\'я', 'Залізо', 'Однаково', 'Залежить'], correct: 2 },
                { text: 'Батько і син разом — 60 років. Батькові — 40. Скільки сину?', answers: ['30', '20', '25', '15'], correct: 1 },
                { text: 'Скільки разів можна відняти 5 від 25?', answers: ['4', '5', '6', '1'], correct: 1 },
                { text: 'Продовж: А, Б, В, Г, ...', answers: ['Д', 'Е', 'Ж', 'Є'], correct: 0 },
                { text: 'У кошику 5 яблук. Як роздати 5 дітям, щоб 1 яблуко залишилось у кошику?', answers: ['Неможливо', 'Віддати разом з кошиком', 'Розрізати', 'З\'їсти'], correct: 1 },
                { text: 'Яке число наступне: 10, 20, 30, 40, ...', answers: ['45', '50', '60', '55'], correct: 1 }
            ]
        },
        {
            title: 'Мистецтво та музика', subject: 'Інше', difficulty: 'easy',
            questions: [
                { text: 'Скільки кольорів у веселці?', answers: ['5', '6', '7', '8'], correct: 2 },
                { text: 'Хто написав «Мону Лізу»?', answers: ['Ван Гог', 'Леонардо да Вінчі', 'Пікассо', 'Моне'], correct: 1 },
                { text: 'Скільки струн у класичній гітарі?', answers: ['4', '5', '6', '7'], correct: 2 },
                { text: 'Який колір утворюється при змішуванні синього та жовтого?', answers: ['Червоний', 'Зелений', 'Фіолетовий', 'Помаранчевий'], correct: 1 },
                { text: 'Який інструмент має клавіші?', answers: ['Скрипка', 'Піаніно', 'Флейта', 'Барабан'], correct: 1 },
                { text: 'Хто композитор «Місячної сонати»?', answers: ['Моцарт', 'Бетховен', 'Бах', 'Шопен'], correct: 1 },
                { text: 'Як називається картина з зображенням людини?', answers: ['Пейзаж', 'Портрет', 'Натюрморт', 'Абстракція'], correct: 1 },
                { text: 'Яка країна батьківщина опери?', answers: ['Франція', 'Італія', 'Німеччина', 'Іспанія'], correct: 1 },
                { text: 'Як називається швидкий темп у музиці?', answers: ['Адажіо', 'Алегро', 'Анданте', 'Ларго'], correct: 1 },
                { text: 'Хто автор «Кобзаря»?', answers: ['Франко', 'Шевченко', 'Леся Українка', 'Сковорода'], correct: 1 }
            ]
        },
        {
            title: 'Космос', subject: 'Інше', difficulty: 'medium',
            questions: [
                { text: 'Скільки планет у Сонячній системі?', answers: ['7', '8', '9', '10'], correct: 1 },
                { text: 'Найбільша планета Сонячної системи?', answers: ['Сатурн', 'Юпітер', 'Уран', 'Нептун'], correct: 1 },
                { text: 'Яка планета найближче до Сонця?', answers: ['Венера', 'Меркурій', 'Земля', 'Марс'], correct: 1 },
                { text: 'Червона планета — це:', answers: ['Венера', 'Марс', 'Юпітер', 'Сатурн'], correct: 1 },
                { text: 'Супутник Землі?', answers: ['Сонце', 'Місяць', 'Марс', 'Венера'], correct: 1 },
                { text: 'Скільки планет мають кільця?', answers: ['1', '2', '4', '8'], correct: 2 },
                { text: 'Що таке Сонце?', answers: ['Планета', 'Зірка', 'Комета', 'Супутник'], correct: 1 },
                { text: 'Перший космонавт світу?', answers: ['Гагарін', 'Армстронг', 'Леонов', 'Титов'], correct: 0 },
                { text: 'Перший космонавт незалежної України?', answers: ['Каденюк', 'Гагарін', 'Леонов', 'Терешкова'], correct: 0 },
                { text: 'Найменша планета Сонячної системи?', answers: ['Марс', 'Меркурій', 'Венера', 'Плутон'], correct: 1 }
            ]
        }
    ];
    defaults.forEach((q, idx) => {
        const id = makeId('quiz');
        DB.quizzes[id] = {
            id,
            title: q.title,
            author,
            authorLogin,
            subject: q.subject,
            difficulty: q.difficulty,
            questions: q.questions,
            public: true,
            plays: 0,
            likes: 0,
            createdAt: Date.now() + idx
        };
    });
    saveQuizzes();
    console.log('[db] created', defaults.length, 'default quizzes');
}

/* ============================================================
   AUTH
   ============================================================ */
app.post('/api/auth/login', (req, res) => {
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(ip, 30)) return res.status(429).json({ ok: false, error: 'Занадто багато спроб' });
    const { login, password } = req.body || {};
    if (!login || !password) return res.json({ ok: false, error: 'Введи логін і пароль' });
    const user = DB.users[String(login).toLowerCase().trim()];
    if (!user) return res.json({ ok: false, error: 'Невірний логін або пароль' });
    let ok = false;
    if (user.passwordHash) ok = verifyPassword(password, user.passwordHash);
    else if (user.password) ok = (user.password === password);
    if (!ok) return res.json({ ok: false, error: 'Невірний логін або пароль' });
    const token = makeId('tok');
    user.lastToken = token;
    user.lastLoginAt = Date.now();
    saveUsers();
    res.json({ ok: true, token, user: publicUser(user, getTodayCoins(user.login)) });
});

app.post('/api/auth/me', (req, res) => {
    const { token } = req.body || {};
    if (!token) return res.json({ ok: false });
    const user = Object.values(DB.users).find(u => u.lastToken === token);
    if (!user) return res.json({ ok: false });
    res.json({ ok: true, user: publicUser(user, getTodayCoins(user.login)) });
});

app.post('/api/user/save-profile', (req, res) => {
    const { token, profile } = req.body || {};
    if (!token) return res.json({ ok: false, error: 'Немає токена' });
    if (!profile || typeof profile !== 'object') return res.json({ ok: false, error: 'Немає профілю' });
    const user = Object.values(DB.users).find(u => u.lastToken === token);
    if (!user) return res.json({ ok: false, error: 'Юзера не знайдено' });

    if (typeof profile.xp === 'number') user.xp = Math.max(0, profile.xp);
    if (Array.isArray(profile.ownedAvatars)) user.ownedAvatars = profile.ownedAvatars.slice();
    if (Array.isArray(profile.ownedAccessories)) user.ownedAccessories = profile.ownedAccessories.slice();
    if (Array.isArray(profile.ownedThemes)) user.ownedThemes = profile.ownedThemes.slice();
    if (typeof profile.equippedAvatar === 'string') user.avatarId = profile.equippedAvatar;
    if (typeof profile.equippedHead === 'string') user.equippedHead = profile.equippedHead;
    if (typeof profile.equippedEyes === 'string') user.equippedEyes = profile.equippedEyes;
    if (typeof profile.equippedEffect === 'string') user.equippedEffect = profile.equippedEffect;
    if (typeof profile.theme === 'string') user.theme = profile.theme;
    if (profile.completedQuests && typeof profile.completedQuests === 'object') {
        user.completedQuests = profile.completedQuests;
    }

    const av = SHOP.avatars.find(a => a.id === user.avatarId);
    if (av) user.avatar = av.emoji;

    const freeAvatars = ['a_smile', 'a_grin', 'a_cool'];
    freeAvatars.forEach(id => {
        if (!user.ownedAvatars) user.ownedAvatars = [];
        if (!user.ownedAvatars.includes(id)) user.ownedAvatars.push(id);
    });
    if (!user.ownedThemes) user.ownedThemes = ['t_neon', 't_pastel'];

    saveUsers();
    res.json({ ok: true, user: publicUser(user, getTodayCoins(user.login)) });
});

app.post('/api/user/spend-coins', (req, res) => {
    const { token, amount, itemId, itemType } = req.body || {};
    if (!token) return res.json({ ok: false, error: 'Немає токена' });
    const user = Object.values(DB.users).find(u => u.lastToken === token);
    if (!user) return res.json({ ok: false, error: 'Юзера не знайдено' });
    const cost = parseInt(amount, 10);
    if (isNaN(cost) || cost <= 0) return res.json({ ok: false, error: 'Хибна сума' });
    if ((user.coins || 0) < cost) return res.json({ ok: false, error: 'Недостатньо СанКоїнів' });
    user.coins -= cost;
    logCoins(user.login, -cost, 'Покупка: ' + (itemId || 'невідомо') + ' (' + (itemType || 'item') + ')');
    saveUsers();
    res.json({ ok: true, coins: user.coins });
});

function publicUser(u, todayCoins) {
    return {
        login: u.login, role: u.role, name: u.name,
        coins: u.coins || 0, xp: u.xp || 0, level: getLevelFromXp(u.xp || 0),
        todayCoins: todayCoins || 0, dailyCap: DAILY_COIN_CAP,
        avatar: u.avatar || '😶', avatarId: u.avatarId || 'a_smile',
        equippedHead: u.equippedHead || '',
        equippedEyes: u.equippedEyes || '',
        equippedEffect: u.equippedEffect || '',
        ownedAvatars: u.ownedAvatars || ['a_smile', 'a_grin', 'a_cool'],
        ownedAccessories: u.ownedAccessories || [],
        ownedThemes: u.ownedThemes || ['t_neon', 't_pastel'],
        theme: u.theme || 'neon',
        completedQuests: u.completedQuests || {},
        classStudents: u.classStudents || [],
        subjects: u.subjects || null,
        isBot: !!u.isBot,
        createdAt: u.createdAt
    };
}

function requireTeacher(req, res, next) {
    const { token } = req.body || {};
    if (!token) return res.status(401).json({ ok: false, error: 'Немає токена' });
    const user = Object.values(DB.users).find(u => u.lastToken === token && u.role === 'teacher');
    if (!user) return res.status(403).json({ ok: false, error: 'Тільки для вчителя' });
    req.teacher = user;
    next();
}

/* ============================================================
   TEACHER
   ============================================================ */
app.post('/api/teacher/create-student', requireTeacher, (req, res) => {
    const { login, password, name } = req.body || {};
    if (!login || !password || !name) return res.json({ ok: false, error: 'Заповни всі поля' });
    const key = String(login).toLowerCase().trim();
    if (DB.users[key]) return res.json({ ok: false, error: 'Такий логін вже існує' });
    const student = {
        login: key, passwordHash: hashPassword(password), role: 'student',
        name: String(name).slice(0, 32), coins: 0, xp: 0,
        avatar: '😶', avatarId: 'a_smile',
        ownedAvatars: ['a_smile', 'a_grin', 'a_cool'],
        ownedAccessories: [], ownedThemes: ['t_neon', 't_pastel'],
        theme: 'neon', completedQuests: {}, createdAt: Date.now(), createdBy: req.teacher.login
    };
    DB.users[key] = student;
    if (!req.teacher.classStudents) req.teacher.classStudents = [];
    req.teacher.classStudents.push(key);
    saveUsers();
    res.json({ ok: true, student: publicUser(student, 0) });
});

app.post('/api/teacher/add-bots', requireTeacher, (req, res) => {
    const { namesText } = req.body || {};
    if (!namesText) return res.json({ ok: false, error: 'Введи імена' });
    const lines = String(namesText).split('\n').map(s => s.trim()).filter(Boolean).slice(0, 100);
    const added = [];
    if (!req.teacher.classStudents) req.teacher.classStudents = [];
    for (const fullName of lines) {
        const botLogin = 'bot_' + Math.random().toString(36).slice(2, 8);
        DB.users[botLogin] = {
            login: botLogin, role: 'student', name: fullName.slice(0, 32),
            coins: 0, xp: 0,
            avatar: AVATARS_BOT[Math.floor(Math.random() * AVATARS_BOT.length)],
            avatarId: 'a_smile',
            ownedAvatars: ['a_smile', 'a_grin', 'a_cool'],
            ownedAccessories: [],
            ownedThemes: ['t_neon', 't_pastel'], theme: 'neon',
            completedQuests: {}, isBot: true,
            createdAt: Date.now(), createdBy: req.teacher.login
        };
        req.teacher.classStudents.push(botLogin);
        added.push({ login: botLogin, name: fullName });
    }
    saveUsers();
    res.json({ ok: true, added });
});

app.post('/api/teacher/class', requireTeacher, (req, res) => {
    const list = (req.teacher.classStudents || [])
        .map(l => DB.users[l])
        .filter(Boolean)
        .map(u => publicUser(u, getTodayCoins(u.login)));
    res.json({ ok: true, students: list });
});

app.post('/api/teacher/remove-student', requireTeacher, (req, res) => {
    const key = String(req.body.login || '').toLowerCase();
    if (!DB.users[key]) return res.json({ ok: false });
    delete DB.users[key];
    req.teacher.classStudents = (req.teacher.classStudents || []).filter(l => l !== key);
    saveUsers();
    res.json({ ok: true });
});

app.post('/api/teacher/subjects', requireTeacher, (req, res) => {
    res.json({ ok: true, subjects: req.teacher.subjects || DEFAULT_SUBJECTS.slice() });
});

app.post('/api/teacher/subjects/add', requireTeacher, (req, res) => {
    const { name } = req.body || {};
    if (!name) return res.json({ ok: false });
    if (!req.teacher.subjects) req.teacher.subjects = DEFAULT_SUBJECTS.slice();
    const n = String(name).slice(0, 40).trim();
    if (!n) return res.json({ ok: false });
    if (!req.teacher.subjects.includes(n)) {
        req.teacher.subjects.push(n);
        saveUsers();
    }
    res.json({ ok: true, subjects: req.teacher.subjects });
});

app.post('/api/teacher/subjects/delete', requireTeacher, (req, res) => {
    const { name } = req.body || {};
    if (!req.teacher.subjects) req.teacher.subjects = DEFAULT_SUBJECTS.slice();
    req.teacher.subjects = req.teacher.subjects.filter(s => s !== name);
    saveUsers();
    res.json({ ok: true, subjects: req.teacher.subjects });
});

/* ============================================================
   QUIZ
   ============================================================ */
app.get('/api/quizzes', (req, res) => {
    const list = Object.values(DB.quizzes)
        .filter(q => q.public !== false)
        .map(q => ({
            id: q.id, title: q.title, author: q.author,
            subject: q.subject, difficulty: q.difficulty,
            questionsCount: q.questions.length,
            plays: q.plays || 0, likes: q.likes || 0,
            createdAt: q.createdAt
        }))
        .sort((a, b) => (b.plays || 0) - (a.plays || 0));
    res.json({ ok: true, quizzes: list });
});

app.get('/api/quizzes/:id', (req, res) => {
    const q = DB.quizzes[req.params.id];
    if (!q) return res.json({ ok: false, error: 'Квіз не знайдено' });
    res.json({ ok: true, quiz: q });
});

app.post('/api/quizzes/create', requireTeacher, (req, res) => {
    const { title, subject, difficulty, questions, isPublic } = req.body || {};
    if (!title || !Array.isArray(questions) || questions.length === 0) {
        return res.json({ ok: false, error: 'Заповни назву й додай питання' });
    }
    const errors = [];
    const cleaned = questions.map((q, i) => {
        const text = String(q.text || '').trim();
        const answers = (q.answers || []).map(a => String(a).trim());
        const correct = parseInt(q.correct, 10);
        if (!text) errors.push('Питання ' + (i + 1) + ': порожній текст');
        if (answers.length < 2) errors.push('Питання ' + (i + 1) + ': менше 2 відповідей');
        if (answers.some(a => !a)) errors.push('Питання ' + (i + 1) + ': порожня відповідь');
        if (new Set(answers.map(a => a.toLowerCase())).size !== answers.length) {
            errors.push('Питання ' + (i + 1) + ': дублюються');
        }
        if (isNaN(correct) || correct < 0 || correct >= answers.length) {
            errors.push('Питання ' + (i + 1) + ': не позначено правильну');
        }
        return { text, answers, correct };
    });
    if (errors.length > 0) return res.json({ ok: false, error: 'Помилки', details: errors });
    const quiz = {
        id: makeId('quiz'),
        title: String(title).slice(0, 80),
        author: req.teacher.name || req.teacher.login,
        authorLogin: req.teacher.login,
        subject: String(subject || 'Інше').slice(0, 40),
        difficulty: String(difficulty || 'medium'),
        questions: cleaned,
        public: isPublic !== false,
        plays: 0, likes: 0, createdAt: Date.now()
    };
    DB.quizzes[quiz.id] = quiz;
    saveQuizzes();
    res.json({ ok: true, quiz });
});

app.post('/api/quizzes/:id/like', (req, res) => {
    const q = DB.quizzes[req.params.id];
    if (!q) return res.json({ ok: false });
    q.likes = (q.likes || 0) + 1;
    saveQuizzes();
    res.json({ ok: true, likes: q.likes });
});

app.post('/api/quizzes/:id/delete', requireTeacher, (req, res) => {
    const q = DB.quizzes[req.params.id];
    if (!q) return res.json({ ok: false });
    if (q.authorLogin !== req.teacher.login) return res.json({ ok: false, error: 'Не твій квіз' });
    delete DB.quizzes[req.params.id];
    saveQuizzes();
    res.json({ ok: true });
});

app.post('/api/quizzes/mine', requireTeacher, (req, res) => {
    const list = Object.values(DB.quizzes)
        .filter(q => q.authorLogin === req.teacher.login)
        .map(q => ({
            id: q.id, title: q.title, subject: q.subject,
            questionsCount: q.questions.length,
            plays: q.plays || 0, likes: q.likes || 0,
            public: q.public, createdAt: q.createdAt
        }));
    res.json({ ok: true, quizzes: list });
});

/* ============================================================
   HOMEWORK
   ============================================================ */
app.post('/api/homework/create', requireTeacher, (req, res) => {
    const { quizId, title, deadline, classLogins, autoPoints } = req.body || {};
    if (!quizId || !DB.quizzes[quizId]) return res.json({ ok: false, error: 'Квіз не знайдено' });
    if (!deadline) return res.json({ ok: false, error: 'Вкажи дедлайн' });
    const hw = {
        id: makeId('hw'),
        quizId,
        quizTitle: DB.quizzes[quizId].title,
        title: String(title || DB.quizzes[quizId].title).slice(0, 80),
        deadline: parseInt(deadline, 10),
        authorLogin: req.teacher.login,
        classLogins: Array.isArray(classLogins) && classLogins.length > 0
            ? classLogins
            : (req.teacher.classStudents || []).slice(),
        autoPoints: autoPoints !== false,
        createdAt: Date.now(),
        submissions: {}
    };
    DB.homework[hw.id] = hw;
    saveHomework();
    scheduleBotHomework(hw);
    res.json({ ok: true, homework: hw });
});

function scheduleBotHomework(hw) {
    const quiz = DB.quizzes[hw.quizId];
    if (!quiz) return;
    const questionsCount = quiz.questions.length;
    hw.classLogins.forEach(login => {
        const u = DB.users[login];
        if (!u || !u.isBot) return;
        if (hw.submissions[login]) return;
        const roll = Math.random();
        let tier;
        if (roll < 0.05) tier = 'none';
        else if (roll < 0.15) tier = 'bad';
        else if (roll < 0.40) tier = 'ok';
        else tier = 'good';
        const delay = 5 * 60 * 1000 + Math.random() * (55 * 60 * 1000);
        setTimeout(() => {
            const h = DB.homework[hw.id];
            if (!h) return;
            if (h.submissions[login]) return;
            if (tier === 'none') return;
            let percent;
            if (tier === 'good') percent = 80 + Math.round(Math.random() * 20);
            else if (tier === 'ok') percent = 60 + Math.round(Math.random() * 15);
            else percent = 35 + Math.round(Math.random() * 15);
            const total = questionsCount;
            let correct = Math.round((percent / 100) * total);
            if (correct > total) correct = total;
            if (correct < 0) correct = 0;
            percent = Math.round((correct / total) * 100);
            const now = Date.now();
            const isLate = now > h.deadline;
            let grade = autoGrade(percent);
            if (isLate) grade = Math.max(1, grade - 1);
            const comments = BOT_HW_COMMENTS[tier] || [''];
            const comment = comments[Math.floor(Math.random() * comments.length)];
            h.submissions[login] = {
                login, correct, total, percent, grade,
                autoGrade: autoGrade(percent), isLate,
                timeSpent: 60 + Math.round(Math.random() * 600),
                submittedAt: now,
                gradedBy: 'auto', gradedAt: now,
                comment: comment || ''
            };
            saveHomework();
            if (h.autoPoints !== false) {
                addPointAuto(login, correct * 10, 'За ДЗ «' + h.title + '»', 'homework');
            }
        }, delay);
    });
}

app.post('/api/homework/mine', requireTeacher, (req, res) => {
    const list = Object.values(DB.homework)
        .filter(h => h.authorLogin === req.teacher.login)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(h => ({ ...h, submissionsCount: Object.keys(h.submissions || {}).length }));
    res.json({ ok: true, homework: list });
});

app.post('/api/homework/for-student', (req, res) => {
    const { login } = req.body || {};
    if (!login) return res.json({ ok: false });
    const list = Object.values(DB.homework)
        .filter(h => h.classLogins.includes(login))
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(h => ({
            id: h.id, quizId: h.quizId, quizTitle: h.quizTitle,
            title: h.title, deadline: h.deadline, author: h.authorLogin,
            submitted: !!h.submissions[login],
            submission: h.submissions[login] || null
        }));
    res.json({ ok: true, homework: list });
});

app.post('/api/homework/submit', (req, res) => {
    const { homeworkId, login, correct, total, timeSpent } = req.body || {};
    if (!homeworkId || !login) return res.json({ ok: false });
    const hw = DB.homework[homeworkId];
    if (!hw) return res.json({ ok: false });
    if (hw.submissions[login]) return res.json({ ok: false, error: 'Ти вже здав' });
    const now = Date.now();
    const isLate = now > hw.deadline;
    const percent = total > 0 ? Math.round((correct / total) * 100) : 0;
    let grade = autoGrade(percent);
    if (isLate) grade = Math.max(1, grade - 1);
    hw.submissions[login] = {
        login, correct, total, percent, grade,
        autoGrade: autoGrade(percent), isLate,
        timeSpent: parseInt(timeSpent, 10) || 0,
        submittedAt: now,
        gradedBy: 'auto', gradedAt: now
    };
    saveHomework();
    if (hw.autoPoints !== false) {
        addPointAuto(login, correct * 10, 'За ДЗ «' + hw.title + '»', 'homework');
    }
    res.json({ ok: true, submission: hw.submissions[login] });
});

app.post('/api/grades/set', requireTeacher, (req, res) => {
    const { homeworkId, studentLogin, grade, comment } = req.body || {};
    const hw = DB.homework[homeworkId];
    if (!hw) return res.json({ ok: false });
    const g = parseInt(grade, 10);
    if (isNaN(g) || g < 1 || g > 12) return res.json({ ok: false, error: 'Оцінка 1-12' });
    if (!hw.submissions[studentLogin]) {
        hw.submissions[studentLogin] = {
            login: studentLogin, correct: 0, total: 0, percent: 0, grade: g,
            autoGrade: null, isLate: false, timeSpent: 0,
            submittedAt: Date.now(),
            gradedBy: req.teacher.login, gradedAt: Date.now(),
            comment: String(comment || '').slice(0, 200)
        };
    } else {
        hw.submissions[studentLogin].grade = g;
        hw.submissions[studentLogin].gradedBy = req.teacher.login;
        hw.submissions[studentLogin].gradedAt = Date.now();
        if (comment) hw.submissions[studentLogin].comment = String(comment).slice(0, 200);
    }
    saveHomework();
    res.json({ ok: true, submission: hw.submissions[studentLogin] });
});

app.post('/api/grades/for-student', (req, res) => {
    const { login } = req.body || {};
    if (!login) return res.json({ ok: false });
    const list = [];
    Object.values(DB.homework).forEach(hw => {
        const sub = hw.submissions[login];
        if (!sub) return;
        list.push({
            homeworkId: hw.id, title: hw.title, quizTitle: hw.quizTitle,
            deadline: hw.deadline,
            grade: sub.grade, autoGrade: sub.autoGrade,
            percent: sub.percent, correct: sub.correct, total: sub.total,
            isLate: sub.isLate, submittedAt: sub.submittedAt,
            gradedBy: sub.gradedBy, comment: sub.comment || ''
        });
    });
    list.sort((a, b) => b.submittedAt - a.submittedAt);
    res.json({ ok: true, grades: list });
});

app.post('/api/grades/for-homework', requireTeacher, (req, res) => {
    const { homeworkId } = req.body || {};
    const hw = DB.homework[homeworkId];
    if (!hw || hw.authorLogin !== req.teacher.login) return res.json({ ok: false });
    const list = hw.classLogins.map(login => {
        const u = DB.users[login];
        const sub = hw.submissions[login];
        return {
            login,
            name: u ? u.name : login,
            isBot: u ? !!u.isBot : false,
            submitted: !!sub,
            submission: sub || null
        };
    });
    res.json({ ok: true, students: list });
});

/* ============================================================
   ANALYTICS
   ============================================================ */
app.post('/api/analytics/quiz', requireTeacher, (req, res) => {
    const { quizId } = req.body || {};
    const quiz = DB.quizzes[quizId];
    if (!quiz) return res.json({ ok: false });
    const an = DB.analytics[quizId] || { questions: {}, games: 0, players: {} };
    const questions = quiz.questions.map((q, i) => {
        const stats = an.questions[i] || { correct: 0, wrong: 0 };
        const total = (stats.correct || 0) + (stats.wrong || 0);
        return {
            index: i, text: q.text,
            correctCount: stats.correct || 0,
            wrongCount: stats.wrong || 0,
            totalAttempts: total,
            wrongPercent: total > 0 ? Math.round((stats.wrong / total) * 100) : 0
        };
    });
    questions.sort((a, b) => b.wrongPercent - a.wrongPercent);
    const players = Object.entries(an.players || {}).map(([login, s]) => {
        const u = DB.users[login];
        return {
            login,
            name: u ? u.name : login,
            isBot: u ? !!u.isBot : false,
            attempts: s.attempts,
            totalCorrect: s.totalCorrect,
            totalQuestions: s.totalQuestions,
            percent: s.totalQuestions > 0 ? Math.round((s.totalCorrect / s.totalQuestions) * 100) : 0
        };
    });
    players.sort((a, b) => b.totalCorrect - a.totalCorrect);
    res.json({ ok: true, quizTitle: quiz.title, games: an.games || 0, questions, players });
});

app.post('/api/analytics/teacher', requireTeacher, (req, res) => {
    const teacher = req.teacher;
    const myQuizzes = Object.values(DB.quizzes).filter(q => q.authorLogin === teacher.login);
    const totalGames = myQuizzes.reduce((sum, q) => sum + (q.plays || 0), 0);
    const totalLikes = myQuizzes.reduce((sum, q) => sum + (q.likes || 0), 0);
    const hardest = [];
    myQuizzes.forEach(q => {
        const an = DB.analytics[q.id];
        if (!an) return;
        q.questions.forEach((question, i) => {
            const s = an.questions && an.questions[i];
            if (!s) return;
            const total = (s.correct || 0) + (s.wrong || 0);
            if (total < 3) return;
            hardest.push({
                quizId: q.id, quizTitle: q.title, text: question.text,
                wrongPercent: Math.round((s.wrong / total) * 100),
                totalAttempts: total
            });
        });
    });
    hardest.sort((a, b) => b.wrongPercent - a.wrongPercent);
    res.json({
        ok: true,
        quizzesCount: myQuizzes.length,
        totalGames, totalLikes,
        hardest: hardest.slice(0, 10)
    });
});

/* ============================================================
   MARKS
   ============================================================ */
function addMark(login, value, subject, reason, by) {
    if (!DB.marks[login]) DB.marks[login] = [];
    DB.marks[login].unshift({
        id: makeId('mark'),
        value: parseInt(value, 10),
        subject: String(subject || '').slice(0, 40),
        reason: String(reason || '').slice(0, 200),
        by: by || 'system',
        at: Date.now()
    });
    if (DB.marks[login].length > 500) DB.marks[login].length = 500;
    saveMarks();
}

app.post('/api/marks/set', requireTeacher, (req, res) => {
    const { studentLogin, value, subject, reason } = req.body || {};
    const u = DB.users[studentLogin];
    if (!u) return res.json({ ok: false, error: 'Учня не знайдено' });
    const v = parseInt(value, 10);
    if (isNaN(v) || v < 1 || v > 12) return res.json({ ok: false, error: 'Оцінка 1-12' });
    addMark(studentLogin, v, subject, reason, req.teacher.login);
    res.json({ ok: true });
});

app.post('/api/marks/delete', requireTeacher, (req, res) => {
    const { studentLogin, markId } = req.body || {};
    if (!DB.marks[studentLogin]) return res.json({ ok: false });
    DB.marks[studentLogin] = DB.marks[studentLogin].filter(m => m.id !== markId);
    saveMarks();
    res.json({ ok: true });
});

app.post('/api/marks/for-student', (req, res) => {
    const { login } = req.body || {};
    if (!login) return res.json({ ok: false });
    const list = DB.marks[login] || [];
    const avg = list.length > 0 ? (list.reduce((s, m) => s + m.value, 0) / list.length) : 0;
    res.json({ ok: true, marks: list, avg: Math.round(avg * 10) / 10 });
});

app.post('/api/marks/all', requireTeacher, (req, res) => {
    const out = (req.teacher.classStudents || []).map(login => {
        const u = DB.users[login];
        if (!u) return null;
        const list = DB.marks[login] || [];
        const avg = list.length > 0 ? (list.reduce((s, m) => s + m.value, 0) / list.length) : 0;
        return {
            login: u.login, name: u.name,
            marks: list,
            avg: Math.round(avg * 10) / 10
        };
    }).filter(Boolean);
    out.sort((a, b) => a.name.localeCompare(b.name, 'uk'));
    res.json({ ok: true, students: out });
});

/* ============================================================
   POINTS
   ============================================================ */
function addPointAuto(login, value, reason, source) {
    if (!DB.points[login]) DB.points[login] = [];
    DB.points[login].unshift({
        id: makeId('pt'),
        value: parseInt(value, 10) || 0,
        reason: String(reason || '').slice(0, 200),
        source: source || 'auto',
        by: 'system',
        at: Date.now()
    });
    if (DB.points[login].length > 500) DB.points[login].length = 500;
    savePoints();
}

function addPointManual(login, value, reason, source, by) {
    if (!DB.points[login]) DB.points[login] = [];
    DB.points[login].unshift({
        id: makeId('pt'),
        value: parseInt(value, 10) || 0,
        reason: String(reason || '').slice(0, 200),
        source: source || 'manual',
        by: by || 'system',
        at: Date.now()
    });
    if (DB.points[login].length > 500) DB.points[login].length = 500;
    savePoints();
}

app.post('/api/points/set', requireTeacher, (req, res) => {
    const { studentLogin, value, reason } = req.body || {};
    const u = DB.users[studentLogin];
    if (!u) return res.json({ ok: false, error: 'Учня не знайдено' });
    const v = parseInt(value, 10);
    if (isNaN(v)) return res.json({ ok: false, error: 'Число' });
    addPointManual(studentLogin, v, reason || 'Вручну', 'manual', req.teacher.login);
    res.json({ ok: true });
});

app.post('/api/points/delete', requireTeacher, (req, res) => {
    const { studentLogin, pointId } = req.body || {};
    if (!DB.points[studentLogin]) return res.json({ ok: false });
    DB.points[studentLogin] = DB.points[studentLogin].filter(p => p.id !== pointId);
    savePoints();
    res.json({ ok: true });
});

app.post('/api/points/for-student', (req, res) => {
    const { login } = req.body || {};
    if (!login) return res.json({ ok: false });
    const list = DB.points[login] || [];
    const sum = list.reduce((s, p) => s + p.value, 0);
    res.json({ ok: true, points: list, sum });
});

app.post('/api/points/all', requireTeacher, (req, res) => {
    const out = (req.teacher.classStudents || []).map(login => {
        const u = DB.users[login];
        if (!u) return null;
        const list = DB.points[login] || [];
        const sum = list.reduce((s, p) => s + p.value, 0);
        return { login: u.login, name: u.name, points: list, sum };
    }).filter(Boolean);
    out.sort((a, b) => b.sum - a.sum);
    res.json({ ok: true, students: out });
});

/* ============================================================
   COINS LOG
   ============================================================ */
app.post('/api/coins/log', (req, res) => {
    const { login } = req.body || {};
    if (!login) return res.json({ ok: false });
    const list = DB.coinsLog[login] || [];
    const today = getTodayCoins(login);
    res.json({ ok: true, log: list, today, cap: DAILY_COIN_CAP });
});

/* ============================================================
   DUEL
   ============================================================ */
const duelInvites = new Map();
const onlineUsers = new Map();

app.post('/api/duel/invite', (req, res) => {
    const { fromLogin, toLogin } = req.body || {};
    if (!fromLogin || !toLogin) return res.json({ ok: false });
    if (fromLogin === toLogin) return res.json({ ok: false, error: 'Себе не можна' });
    const fromUser = DB.users[fromLogin];
    const toUser = DB.users[toLogin];
    if (!fromUser || !toUser) return res.json({ ok: false, error: 'Не знайдено' });
    const inviteId = makeId('duel');
    duelInvites.set(inviteId, {
        id: inviteId, fromLogin, toLogin,
        createdAt: Date.now(), status: 'pending',
        isBotTarget: !!toUser.isBot
    });
    if (!toUser.isBot) {
        const targetSocket = onlineUsers.get(toLogin);
        if (!targetSocket) return res.json({ ok: false, error: 'Гравець офлайн' });
        io.to(targetSocket).emit('duelInvite', {
            inviteId, fromLogin,
            fromName: fromUser.name,
            fromAvatar: fromUser.avatar,
            expiresAt: Date.now() + 30000
        });
    } else {
        setTimeout(() => {
            const inv = duelInvites.get(inviteId);
            if (!inv || inv.status !== 'pending') return;
            inv.status = 'accepted';
            const fromSocket = onlineUsers.get(fromLogin);
            if (fromSocket) {
                io.to(fromSocket).emit('duelResponse', {
                    inviteId,
                    accept: true,
                    fromLogin: toLogin
                });
            }
        }, 2000);
    }
    res.json({ ok: true, inviteId });
});

app.post('/api/duel/respond', (req, res) => {
    const { inviteId, accept } = req.body || {};
    const inv = duelInvites.get(inviteId);
    if (!inv) return res.json({ ok: false, error: 'Не знайдено' });
    if (inv.status !== 'pending') return res.json({ ok: false, error: 'Вже оброблено' });
    inv.status = accept ? 'accepted' : 'declined';
    const fromSocket = onlineUsers.get(inv.fromLogin);
    if (fromSocket) {
        io.to(fromSocket).emit('duelResponse', {
            inviteId,
            accept: !!accept,
            fromLogin: inv.toLogin
        });
    }
    if (!accept) duelInvites.delete(inviteId);
    res.json({ ok: true });
});

app.post('/api/duel/class-online', (req, res) => {
    const { token } = req.body || {};
    if (!token) return res.json({ ok: false });
    const me = Object.values(DB.users).find(u => u.lastToken === token);
    if (!me) return res.json({ ok: false });
    const teacher = Object.values(DB.users).find(u =>
        u.role === 'teacher' && u.classStudents && u.classStudents.includes(me.login));
    if (!teacher) return res.json({ ok: true, students: [] });
    const students = teacher.classStudents
        .filter(l => l !== me.login)
        .map(l => DB.users[l])
        .filter(Boolean)
        .map(u => ({
            login: u.login, name: u.name, avatar: u.avatar,
            online: u.isBot ? true : onlineUsers.has(u.login),
            level: Math.floor((u.xp || 0) / 100) + 1,
            isBot: !!u.isBot
        }));
    res.json({ ok: true, students });
});

/* ============================================================
   SHOP + HEALTH
   ============================================================ */
app.get('/api/shop', (req, res) => {
    res.json({
        ok: true,
        shop: SHOP,
        economy: ECONOMY,
        quests: QUEST_DEFS,
        reactions: REACTION_EMOJIS,
        chatPhrases: CHAT_PHRASES,
        dailyCoinCap: DAILY_COIN_CAP
    });
});

app.get('/health', (req, res) => {
    res.json({
        ok: true,
        uptime: Math.round(process.uptime()),
        users: Object.keys(DB.users).length,
        quizzes: Object.keys(DB.quizzes).length,
        homework: Object.keys(DB.homework).length,
        games: DB.games.length
    });
});

/* ============================================================
   SOCKET.IO
   ============================================================ */
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['polling', 'websocket'],
    pingInterval: 25000, pingTimeout: 30000,
    maxHttpBufferSize: 5 * 1024 * 1024,
    path: '/socket.io/', allowEIO3: true
});

const rooms = new Map();

function addFeed(room, text) {
    if (!room.feed) room.feed = [];
    room.feed.unshift({ text, t: Date.now() });
    if (room.feed.length > 40) room.feed.length = 40;
}

function getPublicState(room) {
    return {
        pin: room.pin,
        quizId: room.quizId,
        quizTitle: room.quizTitle,
        status: room.status,
        mode: room.mode,
        timePerQuestion: room.timePerQuestion,
        questions: room.questions,
        currentQuestion: room.currentQuestion,
        questionStartedAt: room.questionStartedAt,
        timeLeft: room.timeLeft,
        isSolo: !!room.isSolo,
        isPublic: !!room.isPublic,
        isHomework: !!room.isHomework,
        isDuel: !!room.isDuel,
        players: room.players.map(p => ({
            id: p.id, name: p.name,
            avatar: p.avatar, avatarId: p.avatarId,
            accessories: p.accessories,
            score: p.score, coins: p.coins,
            coinsEarnedThisGame: p.coinsEarnedThisGame || 0,
            xp: p.xp || 0,
            correctCount: p.correctCount,
            wrongCount: p.wrongCount,
            alive: p.alive,
            spectator: (room.mode === 'survival' && !p.alive),
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
    if (room.timer) { clearInterval(room.timer); room.timer = null; }
}
function stopBotTimers(room) {
    if (!room.botTimers) return;
    room.botTimers.forEach(t => clearTimeout(t));
    room.botTimers = [];
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
            if (room.isSolo || room.isHomework || room.isDuel || room.isPublic) {
                scheduleAutoAdvance(room);
            }
        }
    }, 250);
}

function scheduleAutoAdvance(room) {
    if (room._autoAdvanceTimer) clearTimeout(room._autoAdvanceTimer);
    room._autoAdvanceTimer = setTimeout(() => {
        const r = rooms.get(room.pin);
        if (!r || r.status !== 'running') return;
        if (r.currentQuestion + 1 >= r.questions.length) {
            autoFinishRoom(r);
        } else {
            r.currentQuestion++;
            r.firstAnswer = null;
            r.players.forEach(p => { p.answeredThisRound = false; p.lastCorrect = null; });
            addFeed(r, '➡️ Питання ' + (r.currentQuestion + 1));
            stopTimer(r);
            stopBotTimers(r);
            startTimer(r);
            scheduleBotAnswers(r);
            broadcastState(r);
        }
    }, 2000);
}

function autoFinishRoom(room) {
    stopTimer(room);
    stopBotTimers(room);
    room.status = 'finished';
    room.finishedAt = Date.now();

    if (room.isHomework) {
        const me = room.players[0];
        if (me) {
            const hw = DB.homework[room.homeworkId];
            if (hw && !hw.submissions[me.login]) {
                const now = Date.now();
                const isLate = now > hw.deadline;
                const total = me.correctCount + me.wrongCount;
                const percent = total > 0 ? Math.round((me.correctCount / total) * 100) : 0;
                let grade = autoGrade(percent);
                if (isLate) grade = Math.max(1, grade - 1);
                hw.submissions[me.login] = {
                    login: me.login,
                    correct: me.correctCount, total, percent, grade,
                    autoGrade: autoGrade(percent),
                    isLate,
                    timeSpent: Math.round((Date.now() - room.startedAt) / 1000),
                    submittedAt: now,
                    gradedBy: 'auto', gradedAt: now
                };
                saveHomework();
                if (hw.autoPoints !== false) {
                    addPointAuto(me.login, me.correctCount * 10, 'За ДЗ «' + hw.title + '»', 'homework');
                }
            }
        }
    }

    const ranked = room.players.slice().sort((a, b) => b.score - a.score);

    if (room.isDuel && ranked.length === 2) {
        const winner = ranked[0];
        const loser = ranked[1];
        if (winner && winner.login) {
            addCoinsWithCap(winner.login, ECONOMY.duelWin, 'Дуель — перемога');
        }
        if (loser && loser.login) {
            subtractCoins(loser.login, ECONOMY.duelLose, 'Дуель — поразка');
        }
        ranked.forEach((p, idx) => {
            p.finalRank = idx + 1;
            p.finalPrize = idx === 0 ? ECONOMY.duelWin : -ECONOMY.duelLose;
        });
    } else {
        ranked.forEach((p, idx) => {
            const rank = idx + 1;
            const prize = getFinalPrize(rank);
            p.finalRank = rank;
            p.finalPrize = prize;
            if (!p.isBot && p.login) {
                addCoinsWithCap(p.login, prize, 'Призове місце #' + rank + ' (' + room.quizTitle + ')');
            }
        });
    }

    if (room.mode === 'survival') {
        room.players.forEach(p => {
            if (!p.alive) return;
            if (!p.quests) p.quests = {};
            if (!p.quests.survivor) p.quests.survivor = { completed: true };
        });
    }
    if (room.quizId) {
        if (!DB.analytics[room.quizId]) DB.analytics[room.quizId] = { questions: {}, games: 0, players: {} };
        DB.analytics[room.quizId].games = (DB.analytics[room.quizId].games || 0) + 1;
        saveAnalytics();
    }
    room.players.forEach(p => {
        if (p.isBot || !p.login) return;
        const u = DB.users[p.login];
        if (!u) return;
        u.xp = (u.xp || 0) + (p.xp || 0);
    });
    saveUsers();

    broadcastState(room);
    io.to('room_' + room.pin).emit('gameOver');
    room.cleanupTimer = setTimeout(() => {
        const r = rooms.get(room.pin);
        if (r && r.status === 'finished') { cleanupRoom(r); rooms.delete(room.pin); }
    }, 10 * 60 * 1000);
}

function calculateRewards(opts) {
    const { elapsed, timePerQuestion, mode, streak, powerActive } = opts;
    const timeBonus = Math.round(Math.max(0, 1 - elapsed / timePerQuestion) * ECONOMY.timeBonusMax);
    const modeMult = MODES[mode] ? MODES[mode].multiplier : 1.0;
    let streakMultScore = 1.0;
    const keys = Object.keys(ECONOMY.streakScoreMultiplier).map(Number).sort((a, b) => b - a);
    for (const k of keys) {
        if (streak >= k) { streakMultScore = ECONOMY.streakScoreMultiplier[k]; break; }
    }
    const powerMult = (powerActive && powerActive.type === 'double') ? 2 : 1;
    const gainedScore = Math.round(
        (ECONOMY.baseScore + timeBonus) * modeMult * streakMultScore * powerMult
    );
    return {
        score: gainedScore,
        coins: 0,
        xp: Math.round(gainedScore / 10),
        breakdown: { timeBonus }
    };
}

function generateBots(count, customNames) {
    const bots = [];
    const allFirst = FIRST_NAMES_M.concat(FIRST_NAMES_F);
    const used = new Set();
    const possibleAvatars = ['a_smile', 'a_grin', 'a_cool'];
    const possibleHeads = ['', '', '', 'x_cap', 'x_partyhat', 'x_beanie'];
    const possibleEyes = ['', '', '', 'x_glasses', 'x_monocle'];
    const possibleEffects = ['', '', '', '', 'x_star', 'x_heart', 'x_leaf'];
    for (let i = 0; i < count; i++) {
        let name;
        if (customNames && customNames[i]) name = customNames[i];
        else {
            let first, last, full, attempts = 0;
            do {
                first = allFirst[Math.floor(Math.random() * allFirst.length)];
                last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
                full = first + ' ' + last;
                attempts++;
            } while (used.has(full) && attempts < 50);
            used.add(full);
            name = full;
        }
        bots.push({
            id: makeId('bot' + i),
            name,
            avatar: AVATARS_BOT[Math.floor(Math.random() * AVATARS_BOT.length)],
            avatarId: possibleAvatars[Math.floor(Math.random() * possibleAvatars.length)],
            accessories: {
                head: possibleHeads[Math.floor(Math.random() * possibleHeads.length)],
                eyes: possibleEyes[Math.floor(Math.random() * possibleEyes.length)],
                effect: possibleEffects[Math.floor(Math.random() * possibleEffects.length)]
            },
            score: 0, coins: 0, coinsEarnedThisGame: 0, xp: 0,
            isBot: true, correctCount: 0, wrongCount: 0, alive: true,
            answeredThisRound: false, lastCorrect: null,
            botSpeed: 0.5 + Math.random() * 0.5,
            streak: 0, bestStreak: 0,
            powerActive: null, reaction: null,
            finalRank: 0, finalPrize: 0,
            quests: {}, socketId: null
        });
    }
    return bots;
}

function scheduleBotAnswers(room) {
    const q = room.questions[room.currentQuestion];
    if (!q) return;
    const qIndex = room.currentQuestion;
    const qStart = room.questionStartedAt;
    if (!room.botTimers) room.botTimers = [];
    room.players.forEach(p => {
        if (!p.isBot || !p.alive) return;
        const speed = p.botSpeed || 0.7;
        const delayMs = (0.2 + (1 - speed) * 0.7) * room.timePerQuestion * 1000;
        const timer = setTimeout(() => {
            if (room.status !== 'running') return;
            if (room.currentQuestion !== qIndex) return;
            if (room.questionStartedAt !== qStart) return;
            if (p.answeredThisRound) return;
            if (!p.alive) return;
            p.answeredThisRound = true;
            const correctChance = 0.35 + speed * 0.5;
            const isCorrect = Math.random() < correctChance;
            p.lastCorrect = isCorrect;
            const elapsed = (Date.now() - room.questionStartedAt) / 1000;
            if (!room.firstAnswer) room.firstAnswer = p.id;
            if (isCorrect) {
                p.correctCount++;
                p.streak = (p.streak || 0) + 1;
                if (p.streak > (p.bestStreak || 0)) p.bestStreak = p.streak;
                const rewards = calculateRewards({
                    elapsed, timePerQuestion: room.timePerQuestion,
                    mode: room.mode, streak: p.streak,
                    powerActive: p.powerActive
                });
                p.score += rewards.score;
                p.xp = (p.xp || 0) + rewards.xp;
                addFeed(room, '✅ ' + p.name + ' правильно');
                p.powerActive = null;
                if (Math.random() < 0.15) {
                    const phrase = BOT_PHRASES[Math.floor(Math.random() * BOT_PHRASES.length)];
                    io.to('room_' + room.pin).emit('playerChat', {
                        playerId: p.id, playerName: p.name, phrase
                    });
                }
            } else {
                p.wrongCount++;
                p.streak = 0;
                if (room.mode === 'survival' && p.wrongCount >= 3) {
                    p.alive = false;
                    addFeed(room, '💀 ' + p.name + ' вибуває (глядач)');
                }
            }
            broadcastState(room);
        }, delayMs);
        room.botTimers.push(timer);
    });
}

function cleanupRoom(room) {
    stopTimer(room);
    stopBotTimers(room);
    if (room._autoAdvanceTimer) clearTimeout(room._autoAdvanceTimer);
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    if (room.teacherDisconnectTimer) clearTimeout(room.teacherDisconnectTimer);
}

function shuffleQuestions(questions) {
    return shuffleArray(questions.slice()).map(q => {
        const indices = q.answers.map((_, i) => i);
        shuffleArray(indices);
        return {
            text: q.text,
            answers: indices.map(i => q.answers[i]),
            correct: indices.indexOf(q.correct)
        };
    });
}

function trackQuestionAnswer(room, qIndex, isCorrect) {
    const quizId = room.quizId;
    if (!quizId) return;
    if (!DB.analytics[quizId]) DB.analytics[quizId] = { questions: {}, games: 0, players: {} };
    const an = DB.analytics[quizId];
    if (!an.questions[qIndex]) an.questions[qIndex] = { correct: 0, wrong: 0 };
    if (isCorrect) an.questions[qIndex].correct++;
    else an.questions[qIndex].wrong++;
    saveAnalytics();
}

function buildDuelPlayer(u) {
    return {
        id: makeId('pl'), name: u.name, login: u.login,
        avatar: u.avatar, avatarId: u.avatarId || 'a_smile',
        accessories: {
            head: u.equippedHead || '',
            eyes: u.equippedEyes || '',
            effect: u.equippedEffect || ''
        },
        score: 0, coins: 0, coinsEarnedThisGame: 0, xp: 0,
        isBot: !!u.isBot, correctCount: 0, wrongCount: 0, alive: true,
        answeredThisRound: false, lastCorrect: null,
        socketId: u.isBot ? null : (onlineUsers.get(u.login) || null),
        streak: 0, bestStreak: 0,
        powerActive: null, reaction: null, quests: {},
        finalRank: 0, finalPrize: 0,
        botSpeed: 0.5 + Math.random() * 0.5
    };
}

io.on('connection', (socket) => {
    let currentRoomPin = null;
    let role = null;

    socket.on('getShop', (cb) => {
        if (cb) cb({
            ok: true, shop: SHOP, economy: ECONOMY,
            quests: QUEST_DEFS, reactions: REACTION_EMOJIS,
            chatPhrases: CHAT_PHRASES,
            dailyCoinCap: DAILY_COIN_CAP
        });
    });

    socket.on('registerOnline', (payload) => {
        const login = String((payload && payload.login) || '').trim();
        if (!login) return;
        onlineUsers.set(login, socket.id);
        socket.data.login = login;
    });

    socket.on('sendChatPhrase', (payload, cb) => {
        const room = rooms.get(currentRoomPin);
        if (!room) return cb && cb({ ok: false });
        const phrase = String((payload && payload.phrase) || '').slice(0, 30);
        if (!CHAT_PHRASES.includes(phrase)) return cb && cb({ ok: false });
        const player = room.players.find(p => p.id === payload.playerId);
        if (!player) return cb && cb({ ok: false });
        io.to('room_' + room.pin).emit('playerChat', {
            playerId: player.id, playerName: player.name, phrase
        });
        if (cb) cb({ ok: true });
    });

    socket.on('startDuelRoom', (payload, cb) => {
        try {
            const quiz = DB.quizzes[payload && payload.quizId];
            if (!quiz) return cb && cb({ ok: false, error: 'Квіз не знайдено' });
            const myLogin = String(payload.login || '').trim();
            const opponentLogin = String(payload.opponent || '').trim();
            const user1 = DB.users[myLogin];
            const user2 = DB.users[opponentLogin];
            if (!user1 || !user2) return cb && cb({ ok: false, error: 'Не знайдено' });
            const pin = makePin();
            const p1 = buildDuelPlayer(user1);
            p1.socketId = socket.id;
            const p2 = buildDuelPlayer(user2);
            const room = {
                pin, quizId: quiz.id, quizTitle: quiz.title,
                createdAt: Date.now(), status: 'running',
                mode: 'arcade', timePerQuestion: 10,
                questions: shuffleQuestions(quiz.questions).slice(0, 5),
                currentQuestion: 0, questionStartedAt: 0, timeLeft: 10,
                players: [p1, p2], feed: [], firstAnswer: null,
                teacherSocketId: socket.id, isDuel: true,
                timer: null, cleanupTimer: null, teacherDisconnectTimer: null, botTimers: []
            };
            rooms.set(pin, room);
            currentRoomPin = pin; role = 'student';
            socket.join('room_' + pin);
            if (p2.socketId) {
                const s = io.sockets.sockets.get(p2.socketId);
                if (s) {
                    s.join('room_' + pin);
                    s.emit('duelStarted', {
                        pin, playerId: p2.id, state: getPublicState(room)
                    });
                }
            }
            addFeed(room, '⚔️ Дуель: ' + user1.name + ' vs ' + user2.name);
            startTimer(room);
            if (p2.isBot) scheduleBotAnswers(room);
            if (cb) cb({ ok: true, pin, playerId: p1.id, state: getPublicState(room) });
            broadcastState(room);
        } catch (err) {
            console.error('startDuelRoom', err);
            if (cb) cb({ ok: false });
        }
    });

    socket.on('createRoomFromQuiz', (payload, cb) => {
        try {
            const quiz = DB.quizzes[payload && payload.quizId];
            if (!quiz) return cb && cb({ ok: false, error: 'Квіз не знайдено' });
            const mode = (payload.mode && MODES[payload.mode]) ? payload.mode : 'arcade';
            const timePerQuestion = Math.max(5, Math.min(60,
                parseInt(payload.timePerQuestion, 10) || MODES[mode].defaultTime));
            const botCount = Math.max(0, Math.min(200, parseInt(payload.botCount, 10) || 0));
            const customNames = Array.isArray(payload.botNames) ? payload.botNames : null;
            const pin = makePin();
            const bots = generateBots(botCount, customNames);
            const room = {
                pin, quizId: quiz.id, quizTitle: quiz.title,
                createdAt: Date.now(), status: 'lobby',
                mode, timePerQuestion,
                questions: shuffleQuestions(quiz.questions),
                currentQuestion: -1, questionStartedAt: 0, timeLeft: timePerQuestion,
                players: bots, feed: [], firstAnswer: null,
                teacherSocketId: socket.id,
                timer: null, cleanupTimer: null, teacherDisconnectTimer: null, botTimers: []
            };
            rooms.set(pin, room);
            currentRoomPin = pin; role = 'teacher';
            socket.join('room_' + pin);
            addFeed(room, '🎉 Кімнату створено: «' + quiz.title + '»');
            quiz.plays = (quiz.plays || 0) + 1;
            saveQuizzes();
            if (cb) cb({ ok: true, pin, state: getPublicState(room) });
            broadcastState(room);
        } catch (err) { if (cb) cb({ ok: false }); }
    });

    socket.on('startSoloGame', (payload, cb) => {
        try {
            const quiz = DB.quizzes[payload && payload.quizId];
            if (!quiz) return cb && cb({ ok: false });
            const mode = payload.mode || 'arcade';
            const timePerQuestion = Math.max(5, Math.min(60,
                parseInt(payload.timePerQuestion, 10) || MODES[mode].defaultTime));
            const playerName = String(payload.name || 'Учень').slice(0, 24);
            const playerLogin = String(payload.login || 'guest');
            const user = DB.users[playerLogin];
            const pin = makePin();
            const player = {
                id: makeId('pl'), name: playerName, login: playerLogin,
                avatar: user ? user.avatar : '😶',
                avatarId: user ? user.avatarId : 'a_smile',
                accessories: {
                    head: user ? user.equippedHead : '',
                    eyes: user ? user.equippedEyes : '',
                    effect: user ? user.equippedEffect : ''
                },
                score: 0, coins: 0, coinsEarnedThisGame: 0, xp: 0,
                isBot: false, correctCount: 0, wrongCount: 0, alive: true,
                answeredThisRound: false, lastCorrect: null,
                socketId: socket.id, streak: 0, bestStreak: 0,
                powerActive: null, reaction: null, quests: {},
                finalRank: 0, finalPrize: 0
            };
            const room = {
                pin, quizId: quiz.id, quizTitle: quiz.title,
                createdAt: Date.now(), status: 'running',
                mode, timePerQuestion,
                questions: shuffleQuestions(quiz.questions),
                currentQuestion: 0, questionStartedAt: 0, timeLeft: timePerQuestion,
                players: [player], feed: [], firstAnswer: null,
                teacherSocketId: socket.id, isSolo: true,
                timer: null, cleanupTimer: null, teacherDisconnectTimer: null, botTimers: []
            };
            rooms.set(pin, room);
            currentRoomPin = pin; role = 'student';
            socket.join('room_' + pin);
            addFeed(room, '🎯 Соло: ' + quiz.title);
            quiz.plays = (quiz.plays || 0) + 1;
            saveQuizzes();
            startTimer(room);
            if (cb) cb({ ok: true, pin, playerId: player.id, state: getPublicState(room) });
            broadcastState(room);
        } catch (err) { if (cb) cb({ ok: false }); }
    });

    socket.on('startPublicGame', (payload, cb) => {
        try {
            const quiz = DB.quizzes[payload && payload.quizId];
            if (!quiz) return cb && cb({ ok: false });
            const targetCount = Math.max(2, Math.min(10, parseInt(payload.targetCount, 10) || 4));
            const playerName = String(payload.name || 'Учень').slice(0, 24);
            const playerLogin = String(payload.login || 'guest');
            const user = DB.users[playerLogin];
            const mode = payload.mode || 'arcade';
            const timePerQuestion = MODES[mode].defaultTime;
            const pin = makePin();
            const player = {
                id: makeId('pl'), name: playerName, login: playerLogin,
                avatar: user ? user.avatar : '😀',
                avatarId: user ? user.avatarId : 'a_grin',
                accessories: {
                    head: user ? user.equippedHead : '',
                    eyes: user ? user.equippedEyes : '',
                    effect: user ? user.equippedEffect : ''
                },
                score: 0, coins: 0, coinsEarnedThisGame: 0, xp: 0,
                isBot: false, correctCount: 0, wrongCount: 0, alive: true,
                answeredThisRound: false, lastCorrect: null,
                socketId: socket.id, streak: 0, bestStreak: 0,
                powerActive: null, reaction: null, quests: {},
                finalRank: 0, finalPrize: 0
            };
            const bots = generateBots(targetCount - 1, null);
            const room = {
                pin, quizId: quiz.id, quizTitle: quiz.title,
                createdAt: Date.now(), status: 'running',
                mode, timePerQuestion,
                questions: shuffleQuestions(quiz.questions),
                currentQuestion: 0, questionStartedAt: 0, timeLeft: timePerQuestion,
                players: [player].concat(bots), feed: [], firstAnswer: null,
                teacherSocketId: socket.id, isPublic: true,
                timer: null, cleanupTimer: null, teacherDisconnectTimer: null, botTimers: []
            };
            rooms.set(pin, room);
            currentRoomPin = pin; role = 'student';
            socket.join('room_' + pin);
            addFeed(room, '🌐 Гра: ' + quiz.title);
            quiz.plays = (quiz.plays || 0) + 1;
            saveQuizzes();
            startTimer(room);
            scheduleBotAnswers(room);
            if (cb) cb({ ok: true, pin, playerId: player.id, state: getPublicState(room) });
            broadcastState(room);
        } catch (err) { if (cb) cb({ ok: false }); }
    });

    socket.on('startHomeworkGame', (payload, cb) => {
        try {
            const hw = DB.homework[payload && payload.homeworkId];
            if (!hw) return cb && cb({ ok: false, error: 'ДЗ не знайдено' });
            const quiz = DB.quizzes[hw.quizId];
            if (!quiz) return cb && cb({ ok: false });
            const login = String(payload.login || 'guest');
            if (hw.submissions[login]) return cb && cb({ ok: false, error: 'Вже здав' });
            const user = DB.users[login];
            const pin = makePin();
            const player = {
                id: makeId('pl'), name: user ? user.name : login, login,
                avatar: user ? user.avatar : '😶',
                avatarId: user ? user.avatarId : 'a_smile',
                accessories: {
                    head: user ? user.equippedHead : '',
                    eyes: user ? user.equippedEyes : '',
                    effect: user ? user.equippedEffect : ''
                },
                score: 0, coins: 0, coinsEarnedThisGame: 0, xp: 0,
                isBot: false, correctCount: 0, wrongCount: 0, alive: true,
                answeredThisRound: false, lastCorrect: null,
                socketId: socket.id, streak: 0, bestStreak: 0,
                powerActive: null, reaction: null, quests: {},
                finalRank: 0, finalPrize: 0
            };
            const room = {
                pin, quizId: quiz.id, quizTitle: quiz.title,
                createdAt: Date.now(), status: 'running',
                mode: 'arcade', timePerQuestion: 20,
                questions: shuffleQuestions(quiz.questions),
                currentQuestion: 0, questionStartedAt: 0, timeLeft: 20,
                players: [player], feed: [], firstAnswer: null,
                teacherSocketId: socket.id, isSolo: true, isHomework: true,
                homeworkId: hw.id, startedAt: Date.now(),
                timer: null, cleanupTimer: null, teacherDisconnectTimer: null, botTimers: []
            };
            rooms.set(pin, room);
            currentRoomPin = pin; role = 'student';
            socket.join('room_' + pin);
            startTimer(room);
            if (cb) cb({ ok: true, pin, playerId: player.id, state: getPublicState(room) });
            broadcastState(room);
        } catch (err) { if (cb) cb({ ok: false }); }
    });

    socket.on('joinRoom', (payload, cb) => {
        try {
            const pin = String((payload && payload.pin) || '').trim();
            const name = String((payload && payload.name) || '').trim().slice(0, 24);
            const avatarId = String((payload && payload.avatarId) || 'a_smile');
            const accessories = (payload && payload.accessories) || { head: '', eyes: '', effect: '' };
            const xp = Math.max(0, parseInt(payload && payload.xp, 10) || 0);
            if (!/^\d{6}$/.test(pin)) return cb && cb({ ok: false, error: 'Невірний PIN' });
            if (name.length < 2) return cb && cb({ ok: false, error: 'Ім\'я закоротке' });
            const room = rooms.get(pin);
            if (!room) return cb && cb({ ok: false, error: 'Не знайдено' });
            if (room.status === 'finished') return cb && cb({ ok: false, error: 'Гра завершена' });
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
                    id: makeId('pl'), name,
                    avatar: avatarEmoji, avatarId, accessories,
                    score: 0, coins: 0, coinsEarnedThisGame: 0, xp,
                    isBot: false, correctCount: 0, wrongCount: 0, alive: true,
                    answeredThisRound: false, lastCorrect: null,
                    socketId: socket.id, streak: 0, bestStreak: 0,
                    powerActive: null, reaction: null, quests: {},
                    finalRank: 0, finalPrize: 0
                };
                room.players.push(player);
                addFeed(room, '🎒 ' + name + ' приєднався!');
            }
            currentRoomPin = pin; role = 'student';
            socket.join('room_' + pin);
            if (cb) cb({ ok: true, playerId: player.id, state: getPublicState(room) });
            broadcastState(room);
        } catch (err) { if (cb) cb({ ok: false }); }
    });

    socket.on('updateProfile', (payload, cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room) return cb && cb({ ok: false });
            const player = room.players.find(p => p.id === payload.playerId);
            if (!player) return cb && cb({ ok: false });
            const avatarId = String(payload.avatarId || player.avatarId || 'a_smile');
            const found = SHOP.avatars.find(a => a.id === avatarId);
            if (found) {
                player.avatarId = avatarId;
                player.avatar = found.emoji;
            }
            if (payload.accessories) player.accessories = payload.accessories;
            if (typeof payload.xp === 'number') player.xp = Math.max(player.xp || 0, payload.xp);
            if (cb) cb({ ok: true });
            broadcastState(room);
        } catch (err) { if (cb) cb({ ok: false }); }
    });

    socket.on('activatePower', (payload, cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room || room.status !== 'running') return cb && cb({ ok: false });
            const player = room.players.find(p => p.id === payload.playerId);
            if (!player) return cb && cb({ ok: false });
            if ((player.streak || 0) < 3) return cb && cb({ ok: false, error: 'Потрібно 3 поспіль' });
            if (player.powerActive) return cb && cb({ ok: false });
            const type = String(payload.type || 'double');
            if (!['double', 'shield', 'reveal'].includes(type)) return cb && cb({ ok: false });
            player.powerActive = { type, at: Date.now() };
            addFeed(room, '⚡ ' + player.name + ' активував силу');
            if (type === 'shield') room.questionStartedAt += 5000;
            let hintIndexes = null;
            if (type === 'reveal') {
                const q = room.questions[room.currentQuestion];
                if (q) {
                    const wrong = [];
                    q.answers.forEach((_, i) => {
                        if (i !== q.correct) wrong.push(i);
                    });
                    shuffleArray(wrong);
                    hintIndexes = wrong.slice(0, 2);
                }
            }
            if (cb) cb({ ok: true, type, hintIndexes });
            broadcastState(room);
        } catch (err) { if (cb) cb({ ok: false }); }
    });

    socket.on('sendReaction', (payload, cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room) return cb && cb({ ok: false });
            const player = room.players.find(p => p.id === payload.playerId);
            if (!player) return cb && cb({ ok: false });
            const emoji = String(payload.emoji || '').slice(0, 4);
            if (!REACTION_EMOJIS.includes(emoji)) return cb && cb({ ok: false });
            player.reaction = { emoji, t: Date.now() };
            io.to('room_' + room.pin).emit('playerReaction', {
                playerId: player.id, playerName: player.name,
                emoji, t: Date.now()
            });
            if (cb) cb({ ok: true });
            setTimeout(() => {
                const r = rooms.get(room.pin);
                if (!r) return;
                const p = r.players.find(x => x.id === player.id);
                if (p && p.reaction && (Date.now() - p.reaction.t) > 2900) p.reaction = null;
            }, 3200);
        } catch (err) { if (cb) cb({ ok: false }); }
    });

    socket.on('startGame', (cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room || room.teacherSocketId !== socket.id) return cb && cb({ ok: false });
            if (room.status === 'running') return cb && cb({ ok: false });
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
            addFeed(room, '🚀 Гру розпочато!');
            stopTimer(room);
            stopBotTimers(room);
            startTimer(room);
            scheduleBotAnswers(room);
            if (cb) cb({ ok: true });
            broadcastState(room);
        } catch (err) { if (cb) cb({ ok: false }); }
    });

    socket.on('nextQuestion', (cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room || room.teacherSocketId !== socket.id) return cb && cb({ ok: false });
            if (room.status !== 'running') return cb && cb({ ok: false });
            if (room.currentQuestion + 1 >= room.questions.length) {
                return cb && cb({ ok: false, error: 'Останнє питання' });
            }
            room.currentQuestion++;
            room.firstAnswer = null;
            room.players.forEach(p => {
                p.answeredThisRound = false;
                p.lastCorrect = null;
            });
            addFeed(room, '➡️ Питання ' + (room.currentQuestion + 1));
            stopTimer(room);
            stopBotTimers(room);
            startTimer(room);
            scheduleBotAnswers(room);
            if (cb) cb({ ok: true, questionIndex: room.currentQuestion });
            broadcastState(room);
        } catch (err) { if (cb) cb({ ok: false }); }
    });

    socket.on('answer', (payload, cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room || room.status !== 'running') return cb && cb({ ok: false });
            const qIndex = parseInt(payload && payload.q, 10);
            const aIndex = parseInt(payload && payload.a, 10);
            const playerId = payload && payload.playerId;
            if (qIndex !== room.currentQuestion) return cb && cb({ ok: false, error: 'Застаріле' });
            const player = room.players.find(p => p.id === playerId);
            if (!player) return cb && cb({ ok: false });
            if (player.answeredThisRound) return cb && cb({ ok: false, error: 'Вже відповіли' });
            if (!player.alive) return cb && cb({ ok: false, error: 'Ти глядач' });
            const q = room.questions[room.currentQuestion];
            if (!q) return cb && cb({ ok: false });
            if (isNaN(aIndex) || aIndex < 0 || aIndex >= q.answers.length) {
                return cb && cb({ ok: false });
            }
            const isCorrect = (aIndex === q.correct);
            trackQuestionAnswer(room, room.currentQuestion, isCorrect);
            player.answeredThisRound = true;
            player.lastCorrect = isCorrect;
            const elapsed = (Date.now() - room.questionStartedAt) / 1000;
            if (!room.firstAnswer) room.firstAnswer = player.id;
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
                    powerActive: player.powerActive
                });
                player.score += rewards.score;
                player.xp = (player.xp || 0) + rewards.xp;
                addFeed(room, '✅ ' + player.name + ' правильно');
                if (!player.isBot) {
                    if (!player.quests) player.quests = {};
                    if (!player.quests.first_correct && player.correctCount >= 1) {
                        player.quests.first_correct = { completed: true };
                        completedQuests.push('first_correct');
                    }
                    if (!player.quests.correct_3_streak && player.streak >= 3) {
                        player.quests.correct_3_streak = { completed: true };
                        completedQuests.push('correct_3_streak');
                    }
                    if (!player.quests.correct_5_streak && player.streak >= 5) {
                        player.quests.correct_5_streak = { completed: true };
                        completedQuests.push('correct_5_streak');
                    }
                    if (!player.quests.correct_10_total && player.correctCount >= 10) {
                        player.quests.correct_10_total = { completed: true };
                        completedQuests.push('correct_10_total');
                    }
                    if (!player.quests.first_answer && room.firstAnswer === player.id) {
                        player.quests.first_answer = { completed: true };
                        completedQuests.push('first_answer');
                    }
                    if (!player.quests.speed_demon && elapsed <= 3) {
                        player.quests.speed_demon = { completed: true };
                        completedQuests.push('speed_demon');
                    }
                }
                player.powerActive = null;
            } else {
                player.wrongCount++;
                player.streak = 0;
                addFeed(room, '❌ ' + player.name + ' помилився');
                if (room.mode === 'survival' && player.wrongCount >= 3) {
                    player.alive = false;
                    addFeed(room, '💀 ' + player.name + ' вибуває (глядач)');
                }
            }
            if (cb) cb({
                ok: true,
                isCorrect,
                score: player.score,
                xp: player.xp,
                streak: player.streak,
                completedQuests
            });
            broadcastState(room);
            if (room.isSolo || room.isHomework || room.isDuel || room.isPublic) {
                const allAnswered = room.players.every(p => p.answeredThisRound || !p.alive);
                if (allAnswered) {
                    stopTimer(room);
                    scheduleAutoAdvance(room);
                }
            }
        } catch (err) {
            console.error('answer error', err);
            if (cb) cb({ ok: false });
        }
    });

    socket.on('finishGame', (cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room || room.teacherSocketId !== socket.id) return cb && cb({ ok: false });
            stopTimer(room);
            stopBotTimers(room);
            room.status = 'finished';
            room.finishedAt = Date.now();
            const ranked = room.players.slice().sort((a, b) => b.score - a.score);
            ranked.forEach((p, idx) => {
                const rank = idx + 1;
                const prize = getFinalPrize(rank);
                p.finalRank = rank;
                p.finalPrize = prize;
                if (!p.isBot && p.login) {
                    addCoinsWithCap(p.login, prize, 'Призове місце #' + rank + ' (' + room.quizTitle + ')');
                }
            });
            if (room.mode === 'survival') {
                room.players.forEach(p => {
                    if (!p.alive) return;
                    if (!p.quests) p.quests = {};
                    if (!p.quests.survivor) p.quests.survivor = { completed: true };
                });
            }
            if (room.quizId) {
                if (!DB.analytics[room.quizId]) DB.analytics[room.quizId] = { questions: {}, games: 0, players: {} };
                DB.analytics[room.quizId].games = (DB.analytics[room.quizId].games || 0) + 1;
                saveAnalytics();
            }
            DB.games.unshift({
                pin: room.pin, quizId: room.quizId,
                quizTitle: room.quizTitle,
                finishedAt: room.finishedAt,
                players: ranked.slice(0, 20).map(p => ({
                    name: p.name, score: p.score,
                    coins: p.finalPrize, rank: p.finalRank
                }))
            });
            if (DB.games.length > 500) DB.games.length = 500;
            saveGames();
            room.players.forEach(p => {
                if (p.isBot || !p.login) return;
                const u = DB.users[p.login];
                if (!u) return;
                u.xp = (u.xp || 0) + (p.xp || 0);
            });
            saveUsers();
            if (cb) cb({ ok: true });
            broadcastState(room);
            io.to('room_' + room.pin).emit('gameOver');
            room.cleanupTimer = setTimeout(() => {
                const r = rooms.get(room.pin);
                if (r && r.status === 'finished') { cleanupRoom(r); rooms.delete(room.pin); }
            }, 15 * 60 * 1000);
        } catch (err) { if (cb) cb({ ok: false }); }
    });

    socket.on('finishHomeworkGame', (payload, cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room || !room.isHomework) return cb && cb({ ok: false });
            if (room.status === 'finished') return cb && cb({ ok: false, error: 'Вже завершено' });
            autoFinishRoom(room);
            const me = room.players[0];
            const hw = DB.homework[room.homeworkId];
            const sub = hw && hw.submissions[me.login];
            if (cb) cb({ ok: true, submission: sub || null });
        } catch (err) { if (cb) cb({ ok: false }); }
    });

    socket.on('closeRoom', (cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room || room.teacherSocketId !== socket.id) return cb && cb({ ok: false });
            io.to('room_' + room.pin).emit('roomClosed');
            cleanupRoom(room);
            rooms.delete(room.pin);
            if (cb) cb({ ok: true });
        } catch (err) { if (cb) cb({ ok: false }); }
    });

    socket.on('reconnectTeacher', (payload, cb) => {
        try {
            const pin = String((payload && payload.pin) || '').trim();
            const room = rooms.get(pin);
            if (!room) return cb && cb({ ok: false });
            if (room.teacherDisconnectTimer) {
                clearTimeout(room.teacherDisconnectTimer);
                room.teacherDisconnectTimer = null;
            }
            room.teacherSocketId = socket.id;
            currentRoomPin = pin;
            role = 'teacher';
            socket.join('room_' + pin);
            if (cb) cb({ ok: true, state: getPublicState(room) });
            broadcastState(room);
        } catch (err) { if (cb) cb({ ok: false }); }
    });

    socket.on('disconnect', () => {
        const login = socket.data.login;
        if (login) onlineUsers.delete(login);
        const room = rooms.get(currentRoomPin);
        if (!room) return;
        if (role === 'teacher') {
            addFeed(room, '⚠️ Вчитель від\'єднався...');
            broadcastState(room);
            room.teacherDisconnectTimer = setTimeout(() => {
                const r = rooms.get(room.pin);
                if (r && r.teacherSocketId === socket.id) {
                    io.to('room_' + r.pin).emit('roomClosed');
                    cleanupRoom(r);
                    rooms.delete(r.pin);
                }
            }, 60000);
        }
        if (role === 'student') {
            const player = room.players.find(p => p.socketId === socket.id);
            if (player) {
                player.socketId = null;
                player.answeredThisRound = false;
                setTimeout(() => { if (rooms.has(room.pin)) broadcastState(room); }, 2000);
            }
        }
    });
});

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
    if (cleaned > 0) console.log('[cleanup]', cleaned);
}, 5 * 60 * 1000);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get(/^\/(?!socket\.io|api\/).*/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

loadDB();
ensureDefaultTeacher();
ensureDefaultQuizzes();

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

httpServer.listen(PORT, HOST, () => {
    console.log('==============================================');
    console.log('🌟 SunLorem v3.1 — Фінальна');
    console.log('🚀 http://' + HOST + ':' + PORT);
    console.log('👩‍🏫 Вчитель: місс.стівенс / 102938');
    console.log('🪙 Ліміт СанКоїнів/день: ' + DAILY_COIN_CAP);
    console.log('📚 Квізів: ' + Object.keys(DB.quizzes).length);
    console.log('==============================================');
});

function gracefulShutdown(signal) {
    console.log('[shutdown]', signal);
    saveUsers(); saveQuizzes(); saveGames();
    saveHomework(); saveGrades(); saveAnalytics();
    saveMarks(); savePoints(); saveCoinsLog();
    io.close(() => httpServer.close(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
