/* ============================================================
   SunLorem v2.2 — Каталог + Акаунти + Ігри + Боти + ДЗ + Оцінки
   Node.js + Express + Socket.io + JSON-база
   ============================================================ */

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

app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1h', etag: true, fallthrough: true
}));

/* ============================================================
   JSON-БАЗА
   ============================================================ */
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB = { users: {}, quizzes: {}, games: [], homework: {}, grades: {}, analytics: {} };

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

function ensureDefaultTeacher() {
    const login = 'вчителька';
    if (!DB.users[login]) {
        DB.users[login] = {
            login, password: '132', role: 'teacher', name: 'Вчителька',
            coins: 0, xp: 0, avatar: '👩‍🏫', avatarId: 'a_cat',
            ownedAvatars: ['a_cat'], ownedAccessories: [],
            ownedThemes: ['t_neon', 't_pastel'], theme: 'neon',
            completedQuests: {}, classStudents: [], createdAt: Date.now()
        };
        saveUsers();
        console.log('[db] default teacher: вчителька / 132');
    }
}

/* ============================================================
   УТИЛІТИ
   ============================================================ */
function makeId(prefix) {
    return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}
function makePin() {
    for (let i = 0; i < 200; i++) {
        const pin = String(Math.floor(100000 + Math.random() * 900000));
        if (!rooms.has(pin)) return pin;
    }
    return String(Math.floor(100000 + Math.random() * 900000));
}
function hashPassword(pw) {
    return crypto.createHash('sha256').update('sunlorem_salt_' + pw).digest('hex');
}
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

/* ============================================================
   ЕКОНОМІКА
   ============================================================ */
const ECONOMY = {
    coinsCorrect: 1,
    coinsSpeedBonus: 1,
    coinsPerGameCap: 30,
    baseScore: 100,
    timeBonusMax: 50,
    streakScoreMultiplier: { 3: 1.1, 5: 1.2, 7: 1.35, 10: 1.5, 15: 1.75 },
    finalPrizes: { 1: 70, 2: 60, 3: 50 },
    finalTiers: [
        { minRank: 4, maxRank: 5, prize: 25 },
        { minRank: 6, maxRank: 10, prize: 18 },
        { minRank: 11, maxRank: 9999, prize: 10 }
    ]
};
function getFinalPrize(rank) {
    if (ECONOMY.finalPrizes[rank] !== undefined) return ECONOMY.finalPrizes[rank];
    for (const t of ECONOMY.finalTiers) {
        if (rank >= t.minRank && rank <= t.maxRank) return t.prize;
    }
    return 0;
}

/* ============================================================
   КВЕСТИ
   ============================================================ */
const QUEST_DEFS = {
    first_correct:    { id: 'first_correct',    title: 'Перший крок',   desc: 'Дай 1 правильну відповідь',   reward: 30, icon: '🎯' },
    correct_3_streak: { id: 'correct_3_streak', title: 'Розігрів',      desc: '3 правильні поспіль',         reward: 40, icon: '🔥' },
    correct_5_streak: { id: 'correct_5_streak', title: 'У вогні',       desc: '5 правильних поспіль',        reward: 75, icon: '⚡' },
    correct_10_total: { id: 'correct_10_total', title: 'Ерудит',        desc: '10 правильних за гру',        reward: 60, icon: '🧠' },
    first_answer:     { id: 'first_answer',     title: 'Швидкий старт', desc: 'Перша відповідь у раунді',    reward: 20, icon: '🚀' },
    speed_demon:      { id: 'speed_demon',      title: 'Блискавка',     desc: 'Відповідь за 3 секунди',      reward: 50, icon: '💨' },
    survivor:         { id: 'survivor',         title: 'Вижити!',       desc: 'Дожити до кінця',             reward: 35, icon: '🛡️' },
    change_theme:     { id: 'change_theme',     title: 'Стиліст',       desc: 'Зміни тему',                  reward: 25, icon: '🎨' }
};

/* ============================================================
   МАГАЗИН
   ============================================================ */
const SHOP = {
    collections: [
        { id: 'col_base',   name: 'Базова',      emoji: '🎒', bonus: 0 },
        { id: 'col_autumn', name: 'Осінь',       emoji: '🍂', bonus: 50 },
        { id: 'col_space',  name: 'Космос',      emoji: '🚀', bonus: 70 },
        { id: 'col_cyber',  name: 'Кібер',       emoji: '🤖', bonus: 70 },
        { id: 'col_magic',  name: 'Магія',       emoji: '🔮', bonus: 80 },
        { id: 'col_super',  name: 'Супергерої',  emoji: '🦸', bonus: 90 }
    ],
    avatars: [
        { id: 'a_cat', emoji: '🐱', name: 'Кіт', price: 0, col: 'col_base' },
        { id: 'a_dog', emoji: '🐶', name: 'Пес', price: 0, col: 'col_base' },
        { id: 'a_fox', emoji: '🦊', name: 'Лис', price: 0, col: 'col_base' },
        { id: 'a_owl', emoji: '🦉', name: 'Сова', price: 25, col: 'col_autumn' },
        { id: 'a_hedgehog', emoji: '🦔', name: 'Їжак', price: 30, col: 'col_autumn' },
        { id: 'a_squirrel', emoji: '🐿️', name: 'Білка', price: 35, col: 'col_autumn' },
        { id: 'a_deer', emoji: '🦌', name: 'Олень', price: 45, col: 'col_autumn' },
        { id: 'a_bear', emoji: '🐻', name: 'Ведмідь', price: 55, col: 'col_autumn' },
        { id: 'a_astronaut', emoji: '👨‍🚀', name: 'Астронавт', price: 60, col: 'col_space' },
        { id: 'a_alien', emoji: '👽', name: 'Прибулець', price: 55, col: 'col_space' },
        { id: 'a_rocket', emoji: '🚀', name: 'Ракета', price: 40, col: 'col_space' },
        { id: 'a_comet', emoji: '☄️', name: 'Комета', price: 65, col: 'col_space' },
        { id: 'a_ufo', emoji: '🛸', name: 'НЛО', price: 75, col: 'col_space' },
        { id: 'a_saturn', emoji: '🪐', name: 'Сатурн', price: 85, col: 'col_space' },
        { id: 'a_robot', emoji: '🤖', name: 'Робот', price: 60, col: 'col_cyber' },
        { id: 'a_cyborg', emoji: '🦾', name: 'Кіборг', price: 80, col: 'col_cyber' },
        { id: 'a_ninja', emoji: '🥷', name: 'Ніндзя', price: 70, col: 'col_cyber' },
        { id: 'a_dragon', emoji: '🐉', name: 'Дракон', price: 110, col: 'col_cyber' },
        { id: 'a_chip', emoji: '💠', name: 'Чип', price: 90, col: 'col_cyber' },
        { id: 'a_wizard', emoji: '🧙', name: 'Маг', price: 80, col: 'col_magic' },
        { id: 'a_unicorn', emoji: '🦄', name: 'Єдиноріг', price: 85, col: 'col_magic' },
        { id: 'a_fairy', emoji: '🧚', name: 'Фея', price: 95, col: 'col_magic' },
        { id: 'a_genie', emoji: '🧞', name: 'Джин', price: 105, col: 'col_magic' },
        { id: 'a_phoenix', emoji: '🔥', name: 'Фенікс', price: 130, col: 'col_magic' },
        { id: 'a_super', emoji: '🦸', name: 'Герой', price: 100, col: 'col_super' },
        { id: 'a_hero_f', emoji: '🦸‍♀️', name: 'Героїня', price: 100, col: 'col_super' },
        { id: 'a_bat', emoji: '🦇', name: 'Бетмен', price: 120, col: 'col_super' },
        { id: 'a_spider', emoji: '🕷️', name: 'Павук', price: 115, col: 'col_super' },
        { id: 'a_shield', emoji: '🛡️', name: 'Капітан', price: 110, col: 'col_super' },
        { id: 'a_lightning', emoji: '⚡', name: 'Громовержець', price: 140, col: 'col_super' }
    ],
    accessories: [
        { id: 'x_crown', emoji: '👑', name: 'Корона', price: 50, slot: 'head' },
        { id: 'x_hat', emoji: '👒', name: 'Капелюшок', price: 30, slot: 'head' },
        { id: 'x_partyhat', emoji: '🎉', name: 'Ковпак', price: 20, slot: 'head' },
        { id: 'x_cap', emoji: '🧢', name: 'Кепка', price: 15, slot: 'head' },
        { id: 'x_grad', emoji: '🎓', name: 'Шапочка', price: 40, slot: 'head' },
        { id: 'x_beanie', emoji: '🧣', name: 'Шарф', price: 25, slot: 'head' },
        { id: 'x_helmet', emoji: '⛑️', name: 'Шолом', price: 45, slot: 'head' },
        { id: 'x_top_hat', emoji: '🎩', name: 'Циліндр', price: 55, slot: 'head' },
        { id: 'x_glasses', emoji: '🕶️', name: 'Окуляри', price: 25, slot: 'eyes' },
        { id: 'x_goggles', emoji: '🥽', name: 'Захисні', price: 35, slot: 'eyes' },
        { id: 'x_monocle', emoji: '🧐', name: 'Монокль', price: 40, slot: 'eyes' },
        { id: 'x_aura', emoji: '✨', name: 'Сяйво', price: 60, slot: 'effect' },
        { id: 'x_fire', emoji: '🔥', name: 'Полум\'я', price: 70, slot: 'effect' },
        { id: 'x_star', emoji: '⭐', name: 'Зірки', price: 45, slot: 'effect' },
        { id: 'x_rainbow', emoji: '🌈', name: 'Веселка', price: 55, slot: 'effect' },
        { id: 'x_lightning', emoji: '⚡', name: 'Блискавка', price: 65, slot: 'effect' },
        { id: 'x_heart', emoji: '💖', name: 'Сердечка', price: 40, slot: 'effect' },
        { id: 'x_leaf', emoji: '🍁', name: 'Листя', price: 30, slot: 'effect' },
        { id: 'x_snow', emoji: '❄️', name: 'Сніжинки', price: 35, slot: 'effect' }
    ],
    themes: [
        { id: 't_neon', name: 'Неон', price: 0, desc: 'Базовий' },
        { id: 't_pastel', name: 'Пастель', price: 0, desc: 'Базовий' },
        { id: 't_space', name: 'Космос', price: 100, desc: 'Зорі' },
        { id: 't_cyber', name: 'Кіберпанк', price: 130, desc: 'Неон' },
        { id: 't_forest', name: 'Ліс', price: 110, desc: 'Зелений' },
        { id: 't_sunset', name: 'Захід', price: 90, desc: 'Теплий' },
        { id: 't_ocean', name: 'Океан', price: 105, desc: 'Блакитний' },
        { id: 't_candy', name: 'Цукеркова', price: 80, desc: 'Рожева' },
        { id: 't_autumn', name: 'Осінь', price: 120, desc: 'Багряна' }
    ]
};

const REACTION_EMOJIS = ['🎉', '🔥', '👏', '🤔', '🚀', '😂', '😮', '💪', '❓', '💯'];

/* ============================================================
   ІМЕНА ДЛЯ БОТІВ
   ============================================================ */
const FIRST_NAMES_M = ['Андрій','Артем','Арсен','Богдан','Борис','Вадим','Валентин','Валерій','Василь','Віктор','Віталій','Владислав','Володимир','Геннадій','Георгій','Григорій','Данило','Денис','Дмитро','Євген','Єгор','Захар','Іван','Ігор','Ілля','Кирило','Костянтин','Леонід','Максим','Марко','Микита','Микола','Мирон','Михайло','Назар','Нестор','Олег','Олександр','Олексій'];
const FIRST_NAMES_F = ['Аліна','Аліса','Анастасія','Ангеліна','Анна','Аріна','Богдана','Валерія','Вікторія','Віолетта','Владислава','Дарина','Діана','Єва','Єлизавета','Злата','Іванна','Ірина','Каміла','Карина','Катерина','Кіра','Ліліана','Ліза','Людмила','Марія','Марта','Мілана','Мілена','Надія'];
const LAST_NAMES = ['Шевченко','Коваленко','Бондаренко','Ткаченко','Кравченко','Олійник','Шевчук','Поліщук','Бойко','Ковальчук','Коваль','Мельник','Марченко','Лисенко','Руденко','Савченко','Петренко','Іваненко','Мороз','Левченко','Козак','Гриценко','Даниленко','Науменко','Клименко','Панченко','Гаврилюк','Кучеренко','Литвиненко','Сидоренко'];
const AVATARS_BOT = ['😀','😎','🤓','🥳','😺','🐶','🦊','🐼','🐨','🦁','🐯','🐸','🐵','🐧','🦄','🐙','🦖','🐉','🌟','⚡','🔥','🌈','🍀','🎈','🚀','🎨','🎮','⚽','🏆','💎'];

/* ============================================================
   РЕЖИМИ
   ============================================================ */
const MODES = {
    arcade:   { name: 'Аркада',    multiplier: 1.0, defaultTime: 20 },
    survival: { name: 'Виживання', multiplier: 1.5, defaultTime: 15 },
    treasure: { name: 'Скарби',    multiplier: 1.2, defaultTime: 25 }
};

/* ============================================================
   RATE LIMIT
   ============================================================ */
const rateLimits = new Map();
function checkRateLimit(ip, max = 60) {
    const now = Date.now();
    let e = rateLimits.get(ip);
    if (!e || now > e.resetAt) { e = { count: 0, resetAt: now + 60000 }; rateLimits.set(ip, e); }
    e.count++;
    return e.count <= max;
}

/* ============================================================
   AUTH API
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

    res.json({ ok: true, token, user: publicUser(user) });
});

app.post('/api/auth/me', (req, res) => {
    const { token } = req.body || {};
    if (!token) return res.json({ ok: false });
    const user = Object.values(DB.users).find(u => u.lastToken === token);
    if (!user) return res.json({ ok: false });
    res.json({ ok: true, user: publicUser(user) });
});

function publicUser(u) {
    return {
        login: u.login, role: u.role, name: u.name,
        coins: u.coins || 0, xp: u.xp || 0, level: getLevelFromXp(u.xp || 0),
        avatar: u.avatar || '🐱', avatarId: u.avatarId || 'a_cat',
        equippedHead: u.equippedHead || '', equippedEyes: u.equippedEyes || '', equippedEffect: u.equippedEffect || '',
        ownedAvatars: u.ownedAvatars || ['a_cat'],
        ownedAccessories: u.ownedAccessories || [],
        ownedThemes: u.ownedThemes || ['t_neon', 't_pastel'],
        theme: u.theme || 'neon',
        completedQuests: u.completedQuests || {},
        classStudents: u.classStudents || [],
        isBot: !!u.isBot,
        createdAt: u.createdAt
    };
}

/* ============================================================
   TEACHER API
   ============================================================ */
function requireTeacher(req, res, next) {
    const { token } = req.body || {};
    if (!token) return res.status(401).json({ ok: false, error: 'Немає токена' });
    const user = Object.values(DB.users).find(u => u.lastToken === token && u.role === 'teacher');
    if (!user) return res.status(403).json({ ok: false, error: 'Тільки для вчителя' });
    req.teacher = user;
    next();
}

app.post('/api/teacher/create-student', requireTeacher, (req, res) => {
    const { login, password, name } = req.body || {};
    if (!login || !password || !name) return res.json({ ok: false, error: 'Заповни всі поля' });
    const key = String(login).toLowerCase().trim();
    if (DB.users[key]) return res.json({ ok: false, error: 'Такий логін вже існує' });

    const student = {
        login: key, passwordHash: hashPassword(password), role: 'student',
        name: String(name).slice(0, 32),
        coins: 0, xp: 0, avatar: '🐱', avatarId: 'a_cat',
        ownedAvatars: ['a_cat'], ownedAccessories: [],
        ownedThemes: ['t_neon', 't_pastel'], theme: 'neon',
        completedQuests: {}, createdAt: Date.now(), createdBy: req.teacher.login
    };
    DB.users[key] = student;
    if (!req.teacher.classStudents) req.teacher.classStudents = [];
    req.teacher.classStudents.push(key);
    saveUsers();
    res.json({ ok: true, student: publicUser(student) });
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
            login: botLogin, role: 'student',
            name: fullName.slice(0, 32),
            coins: 0, xp: 0,
            avatar: AVATARS_BOT[Math.floor(Math.random() * AVATARS_BOT.length)],
            avatarId: 'a_cat',
            ownedAvatars: ['a_cat'], ownedAccessories: [],
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
        .map(l => DB.users[l]).filter(Boolean).map(publicUser);
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

/* ============================================================
   QUIZ API
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
        if (new Set(answers.map(a => a.toLowerCase())).size !== answers.length)
            errors.push('Питання ' + (i + 1) + ': відповіді дублюються');
        if (isNaN(correct) || correct < 0 || correct >= answers.length)
            errors.push('Питання ' + (i + 1) + ': не позначено правильну');
        return { text, answers, correct };
    });
    if (errors.length > 0) return res.json({ ok: false, error: 'Помилки у питаннях', details: errors });

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
   HOMEWORK API
   ============================================================ */
app.post('/api/homework/create', requireTeacher, (req, res) => {
    const { quizId, title, deadline, classLogins } = req.body || {};
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
        createdAt: Date.now(),
        submissions: {}
    };
    DB.homework[hw.id] = hw;
    saveHomework();
    res.json({ ok: true, homework: hw });
});

app.post('/api/homework/mine', requireTeacher, (req, res) => {
    const list = Object.values(DB.homework)
        .filter(h => h.authorLogin === req.teacher.login)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(h => ({
            ...h,
            submissionsCount: Object.keys(h.submissions || {}).length
        }));
    res.json({ ok: true, homework: list });
});

app.post('/api/homework/for-student', (req, res) => {
    const { login } = req.body || {};
    if (!login) return res.json({ ok: false, error: 'Немає логіна' });
    const list = Object.values(DB.homework)
        .filter(h => h.classLogins.includes(login))
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(h => ({
            id: h.id,
            quizId: h.quizId,
            quizTitle: h.quizTitle,
            title: h.title,
            deadline: h.deadline,
            author: h.authorLogin,
            submitted: !!h.submissions[login],
            submission: h.submissions[login] || null
        }));
    res.json({ ok: true, homework: list });
});

app.post('/api/homework/submit', (req, res) => {
    const { homeworkId, login, correct, total, timeSpent } = req.body || {};
    if (!homeworkId || !login) return res.json({ ok: false, error: 'Немає даних' });
    const hw = DB.homework[homeworkId];
    if (!hw) return res.json({ ok: false, error: 'ДЗ не знайдено' });
    if (hw.submissions[login]) return res.json({ ok: false, error: 'Ти вже здав' });

    const now = Date.now();
    const isLate = now > hw.deadline;
    const percent = total > 0 ? Math.round((correct / total) * 100) : 0;
    let grade = autoGrade(percent);
    if (isLate) grade = Math.max(1, grade - 1);

    const submission = {
        login, correct, total, percent, grade,
        autoGrade: autoGrade(percent), isLate,
        timeSpent: parseInt(timeSpent, 10) || 0,
        submittedAt: now,
        gradedBy: 'auto', gradedAt: now
    };
    hw.submissions[login] = submission;
    saveHomework();

    if (!DB.analytics[hw.quizId]) DB.analytics[hw.quizId] = { questions: {}, games: 0, players: {} };
    const an = DB.analytics[hw.quizId];
    an.games = (an.games || 0) + 1;
    if (!an.players) an.players = {};
    if (!an.players[login]) an.players[login] = { attempts: 0, totalCorrect: 0, totalQuestions: 0 };
    an.players[login].attempts++;
    an.players[login].totalCorrect += correct;
    an.players[login].totalQuestions += total;
    saveAnalytics();

    res.json({ ok: true, submission });
});

/* ============================================================
   GRADES API
   ============================================================ */
app.post('/api/grades/set', requireTeacher, (req, res) => {
    const { homeworkId, studentLogin, grade, comment } = req.body || {};
    if (!homeworkId || !studentLogin) return res.json({ ok: false, error: 'Немає даних' });
    const hw = DB.homework[homeworkId];
    if (!hw) return res.json({ ok: false, error: 'ДЗ не знайдено' });
    const g = parseInt(grade, 10);
    if (isNaN(g) || g < 1 || g > 12) return res.json({ ok: false, error: 'Оцінка від 1 до 12' });

    if (!hw.submissions[studentLogin]) {
        hw.submissions[studentLogin] = {
            login: studentLogin, correct: 0, total: 0, percent: 0,
            grade: g, autoGrade: null, isLate: false, timeSpent: 0,
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
            deadline: hw.deadline, grade: sub.grade, autoGrade: sub.autoGrade,
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
            login, name: u ? u.name : login,
            isBot: u ? !!u.isBot : false,
            submitted: !!sub, submission: sub || null
        };
    });
    res.json({ ok: true, students: list });
});

/* ============================================================
   ANALYTICS API
   ============================================================ */
app.post('/api/analytics/quiz', requireTeacher, (req, res) => {
    const { quizId } = req.body || {};
    if (!quizId) return res.json({ ok: false });
    const quiz = DB.quizzes[quizId];
    if (!quiz) return res.json({ ok: false });
    const an = DB.analytics[quizId] || { questions: {}, games: 0, players: {} };

    const questions = quiz.questions.map((q, i) => {
        const stats = an.questions[i] || { correct: 0, wrong: 0 };
        const total = (stats.correct || 0) + (stats.wrong || 0);
        return {
            index: i, text: q.text,
            correctCount: stats.correct || 0, wrongCount: stats.wrong || 0,
            totalAttempts: total,
            wrongPercent: total > 0 ? Math.round((stats.wrong / total) * 100) : 0
        };
    });
    questions.sort((a, b) => b.wrongPercent - a.wrongPercent);

    const players = Object.entries(an.players || {}).map(([login, s]) => {
        const u = DB.users[login];
        return {
            login, name: u ? u.name : login,
            isBot: u ? !!u.isBot : false,
            attempts: s.attempts, totalCorrect: s.totalCorrect, totalQuestions: s.totalQuestions,
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
                wrongPercent: Math.round((s.wrong / total) * 100), totalAttempts: total
            });
        });
    });
    hardest.sort((a, b) => b.wrongPercent - a.wrongPercent);

    res.json({
        ok: true, quizzesCount: myQuizzes.length, totalGames, totalLikes,
        hardest: hardest.slice(0, 10)
    });
});

/* ============================================================
   SHOP + HEALTH
   ============================================================ */
app.get('/api/shop', (req, res) => {
    res.json({ ok: true, shop: SHOP, economy: ECONOMY, quests: QUEST_DEFS, reactions: REACTION_EMOJIS });
});
app.get('/health', (req, res) => {
    res.json({
        ok: true, uptime: Math.round(process.uptime()),
        users: Object.keys(DB.users).length, quizzes: Object.keys(DB.quizzes).length,
        homework: Object.keys(DB.homework).length, games: DB.games.length
    });
});

/* ============================================================
   HTTP + SOCKET.IO
   ============================================================ */
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['polling', 'websocket'],
    pingInterval: 25000, pingTimeout: 30000,
    maxHttpBufferSize: 5 * 1024 * 1024,
    path: '/socket.io/', allowEIO3: true
});

/* ============================================================
   КІМНАТИ
   ============================================================ */
const rooms = new Map();

function addFeed(room, text) {
    if (!room.feed) room.feed = [];
    room.feed.unshift({ text, t: Date.now() });
    if (room.feed.length > 40) room.feed.length = 40;
}

function getPublicState(room) {
    return {
        pin: room.pin, quizId: room.quizId, quizTitle: room.quizTitle,
        status: room.status, mode: room.mode, timePerQuestion: room.timePerQuestion,
        questions: room.questions, currentQuestion: room.currentQuestion,
        questionStartedAt: room.questionStartedAt, timeLeft: room.timeLeft,
        isSolo: !!room.isSolo, isPublic: !!room.isPublic, isHomework: !!room.isHomework,
        players: room.players.map(p => ({
            id: p.id, name: p.name, avatar: p.avatar, avatarId: p.avatarId,
            accessories: p.accessories, score: p.score, coins: p.coins,
            coinsEarnedThisGame: p.coinsEarnedThisGame || 0, xp: p.xp || 0,
            isBot: p.isBot, correctCount: p.correctCount, wrongCount: p.wrongCount,
            alive: p.alive, answeredThisRound: p.answeredThisRound, lastCorrect: p.lastCorrect,
            streak: p.streak || 0, bestStreak: p.bestStreak || 0,
            powerActive: p.powerActive || null, reaction: p.reaction || null,
            finalRank: p.finalRank || 0, finalPrize: p.finalPrize || 0
        })),
        feed: room.feed || []
    };
}

function broadcastState(room) { io.to('room_' + room.pin).emit('state', getPublicState(room)); }
function stopTimer(room) { if (room.timer) { clearInterval(room.timer); room.timer = null; } }
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
        io.to('room_' + room.pin).emit('tick', { timeLeft: leftInt, questionIndex: room.currentQuestion, total: room.timePerQuestion });
        if (left <= 0) {
            stopTimer(room);
            io.to('room_' + room.pin).emit('timeExpired', { questionIndex: room.currentQuestion });
        }
    }, 250);
}

function calculateRewards(opts) {
    const { elapsed, timePerQuestion, mode, streak, powerActive, coinsEarnedThisGame } = opts;
    const timeBonus = Math.round(Math.max(0, 1 - elapsed / timePerQuestion) * ECONOMY.timeBonusMax);
    const modeMult = MODES[mode] ? MODES[mode].multiplier : 1.0;
    let streakMultScore = 1.0;
    const keys = Object.keys(ECONOMY.streakScoreMultiplier).map(Number).sort((a, b) => b - a);
    for (const k of keys) { if (streak >= k) { streakMultScore = ECONOMY.streakScoreMultiplier[k]; break; } }
    const powerMult = (powerActive && powerActive.type === 'double') ? 2 : 1;
    const gainedScore = Math.round((ECONOMY.baseScore + timeBonus) * modeMult * streakMultScore * powerMult);
    let coins = ECONOMY.coinsCorrect;
    const speedRatio = elapsed / timePerQuestion;
    let speedBonus = 0;
    if (speedRatio <= 0.25) { speedBonus = ECONOMY.coinsSpeedBonus; coins += speedBonus; }
    const remaining = Math.max(0, ECONOMY.coinsPerGameCap - (coinsEarnedThisGame || 0));
    if (coins > remaining) coins = remaining;
    return { score: gainedScore, coins, xp: Math.round(gainedScore / 10), breakdown: { timeBonus, speedBonus, remaining } };
}

function generateBots(count, customNames) {
    const bots = [];
    const allFirst = FIRST_NAMES_M.concat(FIRST_NAMES_F);
    const used = new Set();
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
            id: makeId('bot' + i), name,
            avatar: AVATARS_BOT[Math.floor(Math.random() * AVATARS_BOT.length)],
            avatarId: 'a_cat', accessories: { head: '', eyes: '', effect: '' },
            score: 0, coins: 0, coinsEarnedThisGame: 0, xp: 0,
            isBot: true, correctCount: 0, wrongCount: 0, alive: true,
            answeredThisRound: false, lastCorrect: null,
            botSpeed: 0.5 + Math.random() * 0.5,
            streak: 0, bestStreak: 0, powerActive: null, reaction: null,
            finalRank: 0, finalPrize: 0, quests: {}, socketId: null
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
                    elapsed, timePerQuestion: room.timePerQuestion, mode: room.mode,
                    streak: p.streak, powerActive: p.powerActive,
                    coinsEarnedThisGame: p.coinsEarnedThisGame || 0
                });
                p.score += rewards.score;
                p.coins = (p.coins || 0) + rewards.coins;
                p.coinsEarnedThisGame = (p.coinsEarnedThisGame || 0) + rewards.coins;
                p.xp = (p.xp || 0) + rewards.xp;
                addFeed(room, '🤖 ' + p.name + ' правильно (+' + rewards.score + ')');
                p.powerActive = null;
                if (!p.quests) p.quests = {};
                if (!p.quests.first_correct && p.correctCount >= 1) p.quests.first_correct = { completed: true };
                if (!p.quests.correct_3_streak && p.streak >= 3) p.quests.correct_3_streak = { completed: true };
                if (!p.quests.correct_5_streak && p.streak >= 5) p.quests.correct_5_streak = { completed: true };
                if (!p.quests.speed_demon && elapsed <= 3) p.quests.speed_demon = { completed: true };
            } else {
                p.wrongCount++;
                p.streak = 0;
                if (room.mode === 'survival' && p.wrongCount >= 3) {
                    p.alive = false;
                    addFeed(room, '💀 ' + p.name + ' вибуває');
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
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    if (room.teacherDisconnectTimer) clearTimeout(room.teacherDisconnectTimer);
}

function shuffleQuestions(questions) {
    return shuffleArray(questions.slice()).map(q => {
        const indices = q.answers.map((_, i) => i);
        shuffleArray(indices);
        return { text: q.text, answers: indices.map(i => q.answers[i]), correct: indices.indexOf(q.correct) };
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

/* ============================================================
   SOCKET.IO
   ============================================================ */
io.on('connection', (socket) => {
    console.log('[connect]', socket.id);
    let currentRoomPin = null;
    let role = null;

    socket.on('getShop', (cb) => {
        if (cb) cb({ ok: true, shop: SHOP, economy: ECONOMY, quests: QUEST_DEFS, reactions: REACTION_EMOJIS });
    });

    socket.on('createRoomFromQuiz', (payload, cb) => {
        try {
            const quiz = DB.quizzes[payload && payload.quizId];
            if (!quiz) return cb && cb({ ok: false, error: 'Квіз не знайдено' });
            const mode = (payload.mode && MODES[payload.mode]) ? payload.mode : 'arcade';
            const timePerQuestion = Math.max(5, Math.min(60, parseInt(payload.timePerQuestion, 10) || MODES[mode].defaultTime));
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
        } catch (err) {
            console.error('createRoomFromQuiz', err);
            if (cb) cb({ ok: false, error: 'Помилка' });
        }
    });

    /* ---------- СОЛО ---------- */
    socket.on('startSoloGame', (payload, cb) => {
        try {
            const quiz = DB.quizzes[payload && payload.quizId];
            if (!quiz) return cb && cb({ ok: false, error: 'Квіз не знайдено' });
            const mode = payload.mode || 'arcade';
            const timePerQuestion = Math.max(5, Math.min(60, parseInt(payload.timePerQuestion, 10) || MODES[mode].defaultTime));
            const playerName = String(payload.name || 'Учень').slice(0, 24);
            const playerLogin = String(payload.login || 'guest');
            const user = DB.users[playerLogin];
            const pin = makePin();
            const player = {
                id: makeId('pl'), name: playerName, login: playerLogin,
                avatar: user ? user.avatar : '🐱', avatarId: user ? user.avatarId : 'a_cat',
                accessories: {
                    head: user ? user.equippedHead : '', eyes: user ? user.equippedEyes : '',
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
        } catch (err) {
            console.error('startSoloGame', err);
            if (cb) cb({ ok: false, error: 'Помилка' });
        }
    });

    /* ---------- ГРА З ЛЮДЬМИ (таємні боти) ---------- */
    socket.on('startPublicGame', (payload, cb) => {
        try {
            const quiz = DB.quizzes[payload && payload.quizId];
            if (!quiz) return cb && cb({ ok: false, error: 'Квіз не знайдено' });
            const targetCount = Math.max(2, Math.min(10, parseInt(payload.targetCount, 10) || 4));
            const playerName = String(payload.name || 'Учень').slice(0, 24);
            const playerLogin = String(payload.login || 'guest');
            const user = DB.users[playerLogin];
            const mode = payload.mode || 'arcade';
            const timePerQuestion = MODES[mode].defaultTime;
            const pin = makePin();
            const player = {
                id: makeId('pl'), name: playerName, login: playerLogin,
                avatar: user ? user.avatar : '😀', avatarId: user ? user.avatarId : 'a_cat',
                accessories: {
                    head: user ? user.equippedHead : '', eyes: user ? user.equippedEyes : '',
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
        } catch (err) {
            console.error('startPublicGame', err);
            if (cb) cb({ ok: false, error: 'Помилка' });
        }
    });

    /* ---------- ДЗ-ГРА ---------- */
    socket.on('startHomeworkGame', (payload, cb) => {
        try {
            const hw = DB.homework[payload && payload.homeworkId];
            if (!hw) return cb && cb({ ok: false, error: 'ДЗ не знайдено' });
            const quiz = DB.quizzes[hw.quizId];
            if (!quiz) return cb && cb({ ok: false, error: 'Квіз не знайдено' });
            const login = String(payload.login || 'guest');
            if (hw.submissions[login]) return cb && cb({ ok: false, error: 'Ти вже здав це ДЗ' });
            const user = DB.users[login];
            const mode = 'arcade';
            const timePerQuestion = MODES[mode].defaultTime;
            const pin = makePin();
            const player = {
                id: makeId('pl'), name: user ? user.name : login, login,
                avatar: user ? user.avatar : '🐱', avatarId: user ? user.avatarId : 'a_cat',
                accessories: {
                    head: user ? user.equippedHead : '', eyes: user ? user.equippedEyes : '',
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
                teacherSocketId: socket.id, isSolo: true, isHomework: true,
                homeworkId: hw.id, startedAt: Date.now(),
                timer: null, cleanupTimer: null, teacherDisconnectTimer: null, botTimers: []
            };
            rooms.set(pin, room);
            currentRoomPin = pin; role = 'student';
            socket.join('room_' + pin);
            addFeed(room, '📝 ДЗ: ' + hw.title);
            startTimer(room);
            if (cb) cb({ ok: true, pin, playerId: player.id, state: getPublicState(room) });
            broadcastState(room);
        } catch (err) {
            console.error('startHomeworkGame', err);
            if (cb) cb({ ok: false, error: 'Помилка' });
        }
    });

    socket.on('joinRoom', (payload, cb) => {
        try {
            const pin = String((payload && payload.pin) || '').trim();
            const name = String((payload && payload.name) || '').trim().slice(0, 24);
            const avatarId = String((payload && payload.avatarId) || 'a_cat');
            const accessories = (payload && payload.accessories) || { head: '', eyes: '', effect: '' };
            const xp = Math.max(0, parseInt(payload && payload.xp, 10) || 0);
            if (!/^\d{6}$/.test(pin)) return cb && cb({ ok: false, error: 'Невірний PIN' });
            if (name.length < 2) return cb && cb({ ok: false, error: 'Ім\'я закоротке' });

            const room = rooms.get(pin);
            if (!room) return cb && cb({ ok: false, error: 'Кімнату не знайдено' });
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
                    id: makeId('pl'), name, avatar: avatarEmoji, avatarId, accessories,
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
        } catch (err) {
            console.error('joinRoom', err);
            if (cb) cb({ ok: false, error: 'Помилка входу' });
        }
    });

    socket.on('updateProfile', (payload, cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room) return cb && cb({ ok: false });
            const player = room.players.find(p => p.id === payload.playerId);
            if (!player) return cb && cb({ ok: false });
            const avatarId = String(payload.avatarId || player.avatarId || 'a_cat');
            const found = SHOP.avatars.find(a => a.id === avatarId);
            if (found) { player.avatarId = avatarId; player.avatar = found.emoji; }
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
            if (player.powerActive) return cb && cb({ ok: false, error: 'Вже активна' });
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
                    q.answers.forEach((_, i) => { if (i !== q.correct) wrong.push(i); });
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
                playerId: player.id, playerName: player.name, emoji, t: Date.now()
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
            room.feed = []; room.firstAnswer = null;
            room.players.forEach(p => {
                p.answeredThisRound = false; p.lastCorrect = null;
                p.score = 0; p.correctCount = 0; p.wrongCount = 0;
                p.alive = true; p.streak = 0; p.bestStreak = 0;
                p.powerActive = null; p.reaction = null;
                p.quests = {}; p.coinsEarnedThisGame = 0;
                p.finalPrize = 0; p.finalRank = 0;
            });
            addFeed(room, '🚀 Гру розпочато!');
            stopTimer(room); stopBotTimers(room);
            startTimer(room); scheduleBotAnswers(room);
            if (cb) cb({ ok: true });
            broadcastState(room);
        } catch (err) { if (cb) cb({ ok: false }); }
    });

    socket.on('nextQuestion', (cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room || room.teacherSocketId !== socket.id) return cb && cb({ ok: false });
            if (room.status !== 'running') return cb && cb({ ok: false });
            if (room.currentQuestion + 1 >= room.questions.length) return cb && cb({ ok: false, error: 'Останнє' });
            room.currentQuestion++;
            room.firstAnswer = null;
            room.players.forEach(p => { p.answeredThisRound = false; p.lastCorrect = null; });
            addFeed(room, '➡️ Питання ' + (room.currentQuestion + 1));
            stopTimer(room); stopBotTimers(room);
            startTimer(room); scheduleBotAnswers(room);
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
            if (!player.alive) return cb && cb({ ok: false, error: 'Вибули' });
            const q = room.questions[room.currentQuestion];
            if (!q) return cb && cb({ ok: false });
            if (isNaN(aIndex) || aIndex < 0 || aIndex >= q.answers.length) return cb && cb({ ok: false });
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
                    elapsed, timePerQuestion: room.timePerQuestion, mode: room.mode,
                    streak: player.streak, powerActive: player.powerActive,
                    coinsEarnedThisGame: player.coinsEarnedThisGame || 0
                });
                player.score += rewards.score;
                player.coins = (player.coins || 0) + rewards.coins;
                player.coinsEarnedThisGame = (player.coinsEarnedThisGame || 0) + rewards.coins;
                player.xp = (player.xp || 0) + rewards.xp;
                addFeed(room, '✅ ' + player.name + ' правильно (+' + rewards.score + ')');
                if (!player.isBot) {
                    if (!player.quests) player.quests = {};
                    if (!player.quests.first_correct && player.correctCount >= 1) { player.quests.first_correct = { completed: true }; completedQuests.push('first_correct'); }
                    if (!player.quests.correct_3_streak && player.streak >= 3) { player.quests.correct_3_streak = { completed: true }; completedQuests.push('correct_3_streak'); }
                    if (!player.quests.correct_5_streak && player.streak >= 5) { player.quests.correct_5_streak = { completed: true }; completedQuests.push('correct_5_streak'); }
                    if (!player.quests.correct_10_total && player.correctCount >= 10) { player.quests.correct_10_total = { completed: true }; completedQuests.push('correct_10_total'); }
                    if (!player.quests.first_answer && room.firstAnswer === player.id) { player.quests.first_answer = { completed: true }; completedQuests.push('first_answer'); }
                    if (!player.quests.speed_demon && elapsed <= 3) { player.quests.speed_demon = { completed: true }; completedQuests.push('speed_demon'); }
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
                ok: true, isCorrect, score: player.score, coins: player.coins,
                coinsEarnedThisGame: player.coinsEarnedThisGame || 0,
                coinsRemaining: Math.max(0, ECONOMY.coinsPerGameCap - (player.coinsEarnedThisGame || 0)),
                xp: player.xp, streak: player.streak, completedQuests
            });
            broadcastState(room);
        } catch (err) { if (cb) cb({ ok: false }); }
    });

    socket.on('finishGame', (cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room || room.teacherSocketId !== socket.id) return cb && cb({ ok: false });
            stopTimer(room); stopBotTimers(room);
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
                pin: room.pin, quizId: room.quizId, quizTitle: room.quizTitle,
                finishedAt: room.finishedAt,
                players: ranked.slice(0, 20).map(p => ({ name: p.name, score: p.score, coins: p.coins, rank: p.finalRank, isBot: p.isBot }))
            });
            if (DB.games.length > 500) DB.games.length = 500;
            saveGames();
            room.players.forEach(p => {
                if (p.isBot || !p.login) return;
                const u = DB.users[p.login];
                if (!u) return;
                u.coins = (u.coins || 0) + (p.coins || 0);
                u.xp = (u.xp || 0) + (p.xp || 0);
            });
            saveUsers();
            if (cb) cb({ ok: true, finalPrizes: ranked.map(p => ({ id: p.id, name: p.name, rank: p.finalRank, prize: p.finalPrize })) });
            broadcastState(room);
            io.to('room_' + room.pin).emit('gameOver');
            room.cleanupTimer = setTimeout(() => {
                const r = rooms.get(room.pin);
                if (r && r.status === 'finished') { cleanupRoom(r); rooms.delete(room.pin); }
            }, 15 * 60 * 1000);
        } catch (err) { if (cb) cb({ ok: false }); }
    });

    /* ---------- ЗАВЕРШЕННЯ ДЗ ---------- */
    socket.on('finishHomeworkGame', (payload, cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room || !room.isHomework) return cb && cb({ ok: false });
            stopTimer(room);
            room.status = 'finished';
            room.finishedAt = Date.now();
            const me = room.players[0];
            if (!me) return cb && cb({ ok: false });
            const timeSpent = Math.round((Date.now() - room.startedAt) / 1000);
            const hw = DB.homework[room.homeworkId];
            if (!hw) return cb && cb({ ok: false });
            const now = Date.now();
            const isLate = now > hw.deadline;
            const percent = me.correctCount + me.wrongCount > 0
                ? Math.round((me.correctCount / (me.correctCount + me.wrongCount)) * 100) : 0;
            let grade = autoGrade(percent);
            if (isLate) grade = Math.max(1, grade - 1);
            const submission = {
                login: me.login, correct: me.correctCount,
                total: me.correctCount + me.wrongCount, percent, grade,
                autoGrade: autoGrade(percent), isLate, timeSpent,
                submittedAt: now, gradedBy: 'auto', gradedAt: now
            };
            hw.submissions[me.login] = submission;
            saveHomework();
            const u = DB.users[me.login];
            if (u) { u.coins = (u.coins || 0) + (me.coins || 0); u.xp = (u.xp || 0) + (me.xp || 0); saveUsers(); }
            if (cb) cb({ ok: true, submission });
            broadcastState(room);
            room.cleanupTimer = setTimeout(() => {
                const r = rooms.get(room.pin);
                if (r && r.status === 'finished') { cleanupRoom(r); rooms.delete(room.pin); }
            }, 5 * 60 * 1000);
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

    socket.on('checkPin', (payload, cb) => {
        const pin = String((payload && payload.pin) || '').trim();
        const room = rooms.get(pin);
        if (cb) cb({ ok: !!(room && room.status !== 'finished'), exists: !!room });
    });

    socket.on('reconnectTeacher', (payload, cb) => {
        try {
            const pin = String((payload && payload.pin) || '').trim();
            const room = rooms.get(pin);
            if (!room) return cb && cb({ ok: false, error: 'Не знайдено' });
            if (room.teacherDisconnectTimer) { clearTimeout(room.teacherDisconnectTimer); room.teacherDisconnectTimer = null; }
            room.teacherSocketId = socket.id;
            currentRoomPin = pin; role = 'teacher';
            socket.join('room_' + pin);
            addFeed(room, '✅ Вчитель повернувся');
            if (cb) cb({ ok: true, state: getPublicState(room) });
            broadcastState(room);
        } catch (err) { if (cb) cb({ ok: false }); }
    });

    socket.on('disconnect', (reason) => {
        const room = rooms.get(currentRoomPin);
        if (!room) return;
        if (role === 'teacher') {
            addFeed(room, '⚠️ Вчитель від\'єднався...');
            broadcastState(room);
            room.teacherDisconnectTimer = setTimeout(() => {
                const r = rooms.get(room.pin);
                if (r && r.teacherSocketId === socket.id) {
                    io.to('room_' + r.pin).emit('roomClosed');
                    cleanupRoom(r); rooms.delete(r.pin);
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
        const oldFinished = room.status === 'finished' && room.finishedAt && now - room.finishedAt > 60 * 60 * 1000;
        if (oldLobby || oldFinished) { cleanupRoom(room); rooms.delete(pin); cleaned++; }
    }
    if (cleaned > 0) console.log('[cleanup]', cleaned);
}, 5 * 60 * 1000);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get(/^\/(?!socket\.io|api\/).*/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

loadDB();
ensureDefaultTeacher();

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

httpServer.listen(PORT, HOST, () => {
    console.log('==============================================');
    console.log('🌟 SunLorem v2.2 — ДЗ + Оцінки + Аналітика');
    console.log('🚀 http://' + HOST + ':' + PORT);
    console.log('👩‍🏫 Вчитель: вчителька / 132');
    console.log('📚 Квізів: ' + Object.keys(DB.quizzes).length);
    console.log('👥 Юзерів: ' + Object.keys(DB.users).length);
    console.log('📝 ДЗ: ' + Object.keys(DB.homework).length);
    console.log('==============================================');
});

function gracefulShutdown(signal) {
    console.log('[shutdown]', signal);
    saveUsers(); saveQuizzes(); saveGames(); saveHomework(); saveGrades(); saveAnalytics();
    io.close(() => httpServer.close(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
