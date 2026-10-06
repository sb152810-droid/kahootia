/* ============================================================
   SunLorem: Інтерактивна шкільна система
   Node.js + Express + Socket.io + Gemini AI
   ------------------------------------------------------------
   • Акаунти учнів + ботами (зберігаються в data/data.json)
   • Оцінки, розклад, ДЗ (зберігаються в data/data.json)
   • Вікторина з PIN-кімнатами, ботами, СанКоїнами
   • Кастомні + випадкові імена ботів у вікторинах
   • Шкільний чат класу з AI-ботами через Google Gemini API
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

/* ============================================================
   ПОСТІЙНЕ СХОВИЩЕ
   ============================================================ */
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

let DB = {
    users: {},
    grades: {},
    schedule: {},
    homework: {},
    bots: [],
    meta: { createdAt: Date.now() }
};

function loadDB() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const raw = fs.readFileSync(DATA_FILE, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                DB = Object.assign(DB, parsed);
                if (!DB.users) DB.users = {};
                if (!DB.grades) DB.grades = {};
                if (!DB.schedule) DB.schedule = {};
                if (!DB.homework) DB.homework = {};
                if (!Array.isArray(DB.bots)) DB.bots = [];
            }
        }
    } catch (e) {
        console.warn('[db] load error', e.message);
    }
}

let saveTimer = null;
function saveDB() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        try {
            fs.writeFileSync(DATA_FILE, JSON.stringify(DB, null, 2), 'utf8');
        } catch (e) {
            console.warn('[db] save error', e.message);
        }
    }, 200);
}

function saveDBImmediate() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(DB, null, 2), 'utf8');
    } catch (e) {
        console.warn('[db] save error', e.message);
    }
}

loadDB();

/* ============================================================
   EXPRESS APP
   ============================================================ */
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
    maxAge: '1h',
    etag: true,
    fallthrough: true
}));

/* ============================================================
   GEMINI API
   ============================================================ */
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const GEMINI_ENDPOINT =
    'https://generativelanguage.googleapis.com/v1beta/models/' +
    GEMINI_MODEL + ':generateContent';

const GEMINI_SYSTEM_PROMPT =
    'Ти учень 5–7 класу української школи. Ти дружній, веселий, доброзичливий школяр. ' +
    'Відповідай українською мовою, коротко (1–2 речення), природно, як у звичайному чаті з однокласниками. ' +
    'Іноді додавай одне-два доречних емодзі (😊, 👍, 📚, ✨, 🚀). ' +
    'Категорично заборонено використовувати лайку, грубі, образливі, принизливі слова, слова-паразити ' +
    'чи грубий сленг. Говори виховано, як ввічливий підліток. Якщо тема незрозуміла — перепитай дружньо.';

const FORBIDDEN_WORDS = [
    'фігня', 'фіг', 'блін', 'чорт', 'дідько',
    'дурень', 'ідіот', 'дебил', 'кретин',
    'лох', 'тупий', 'тупа', 'придурок',
    'хай', 'капець', 'піпець'
];

function sanitizeAIOutput(text) {
    if (!text) return text;
    let result = String(text);
    const lower = result.toLowerCase();
    for (const word of FORBIDDEN_WORDS) {
        if (lower.indexOf(word) !== -1) {
            const re = new RegExp(word, 'gi');
            result = result.replace(re, 'ой');
        }
    }
    return result;
}

async function callGeminiChat(history, userText) {
    if (!GEMINI_API_KEY) return null;

    const contents = [];
    contents.push({
        role: 'user',
        parts: [{ text: GEMINI_SYSTEM_PROMPT }]
    });
    contents.push({
        role: 'model',
        parts: [{ text: 'Гаразд, я зрозумів правила. Спілкуюсь як учень 5–7 класу.' }]
    });
    const recent = Array.isArray(history) ? history.slice(-10) : [];
    recent.forEach(m => {
        if (!m || !m.text) return;
        contents.push({
            role: m.isBot ? 'model' : 'user',
            parts: [{ text: String(m.text).slice(0, 400) }]
        });
    });
    contents.push({
        role: 'user',
        parts: [{ text: String(userText).slice(0, 400) }]
    });

    const body = {
        contents,
        generationConfig: {
            temperature: 0.9,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 200
        },
        safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
        ]
    };

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(GEMINI_ENDPOINT + '?key=' + encodeURIComponent(GEMINI_API_KEY), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            console.warn('[gemini] non-ok', res.status, errText.slice(0, 200));
            return null;
        }
        const data = await res.json();
        const cand = data && data.candidates && data.candidates[0];
        if (!cand) return null;
        const parts = cand.content && cand.content.parts;
        if (!Array.isArray(parts) || parts.length === 0) return null;
        let text = parts.map(p => p.text || '').join(' ').trim();
        if (!text) return null;
        text = text.replace(/\s+/g, ' ').trim();
        if (text.length > 300) text = text.slice(0, 300) + '…';
        text = sanitizeAIOutput(text);
        return text;
    } catch (e) {
        console.warn('[gemini] error', e && e.message);
        return null;
    }
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
    for (const tier of ECONOMY.finalTiers) {
        if (rank >= tier.minRank && rank <= tier.maxRank) return tier.prize;
    }
    return 0;
}

/* ============================================================
   КВЕСТИ
   ============================================================ */
const QUEST_DEFS = {
    first_correct:    { id: 'first_correct',    title: 'Перший крок',   desc: 'Дай 1 правильну відповідь',       goal: 1,  reward: 30, icon: '🎯' },
    correct_3_streak: { id: 'correct_3_streak', title: 'Розігрів',      desc: '3 правильні відповіді поспіль',   goal: 3,  reward: 40, icon: '🔥' },
    correct_5_streak: { id: 'correct_5_streak', title: 'У вогні',       desc: '5 правильних відповідей поспіль', goal: 5,  reward: 75, icon: '⚡' },
    correct_10_total: { id: 'correct_10_total', title: 'Ерудит',        desc: '10 правильних відповідей за гру', goal: 10, reward: 60, icon: '🧠' },
    first_answer:     { id: 'first_answer',     title: 'Швидкий старт', desc: 'Перша відповідь у раунді',        goal: 1,  reward: 20, icon: '🚀' },
    speed_demon:      { id: 'speed_demon',      title: 'Блискавка',     desc: 'Відповідай за 3 секунди',         goal: 1,  reward: 50, icon: '💨' },
    survivor:         { id: 'survivor',         title: 'Вижити!',       desc: 'Правильно в режимі «Виживання»',  goal: 1,  reward: 35, icon: '🛡️' },
    chat_master:      { id: 'chat_master',      title: 'Балакун',       desc: 'Напиши 5 повідомлень у чаті',     goal: 5,  reward: 25, icon: '💬' }
};

/* ============================================================
   МАГАЗИН
   ============================================================ */
const SHOP = {
    collections: [
        { id: 'col_base',   name: 'Базова',              emoji: '🎒', desc: 'Стартовий набір', bonus: 0 },
        { id: 'col_autumn', name: 'Осінній табір',       emoji: '🍂', desc: 'Атмосфера осені', bonus: 50 },
        { id: 'col_space',  name: 'Космічна експедиція', emoji: '🚀', desc: 'Підкорювачі зірок', bonus: 70 },
        { id: 'col_cyber',  name: 'Кібер-табір',         emoji: '🤖', desc: 'Технології майбутнього', bonus: 70 },
        { id: 'col_magic',  name: 'Магічний табір',      emoji: '🔮', desc: 'Чарівні створіння', bonus: 80 }
    ],
    avatars: [
        { id: 'a_cat',     emoji: '🐱', name: 'Кіт-астронавт', price: 0,   col: 'col_base',   desc: 'Базовий кіт' },
        { id: 'a_dog',     emoji: '🐶', name: 'Песик-пілот',   price: 0,   col: 'col_base',   desc: 'Вірний друг' },
        { id: 'a_fox',     emoji: '🦊', name: 'Лисичка',       price: 0,   col: 'col_base',   desc: 'Хитра і швидка' },
        { id: 'a_owl',     emoji: '🦉', name: 'Мудра сова',    price: 25,  col: 'col_autumn', desc: 'Символ знань' },
        { id: 'a_hedgehog',emoji: '🦔', name: 'Їжачок',        price: 30,  col: 'col_autumn', desc: 'Колючий друг' },
        { id: 'a_squirrel',emoji: '🐿️', name: 'Білочка',      price: 35,  col: 'col_autumn', desc: 'Збирач горіхів' },
        { id: 'a_deer',    emoji: '🦌', name: 'Олень',         price: 45,  col: 'col_autumn', desc: 'Лісовий володар' },
        { id: 'a_bear',    emoji: '🐻', name: 'Ведмідь',       price: 55,  col: 'col_autumn', desc: 'Господар лісу' },
        { id: 'a_astro',   emoji: '👨‍🚀', name: 'Астронавт',    price: 60,  col: 'col_space',  desc: 'Підкорювач космосу' },
        { id: 'a_alien',   emoji: '👽', name: 'Прибулець',     price: 55,  col: 'col_space',  desc: 'Гість із зірок' },
        { id: 'a_rocket',  emoji: '🚀', name: 'Ракета',        price: 40,  col: 'col_space',  desc: 'Символ швидкості' },
        { id: 'a_comet',   emoji: '☄️', name: 'Комета',        price: 65,  col: 'col_space',  desc: 'Космічний мандрівник' },
        { id: 'a_ufo',     emoji: '🛸', name: 'НЛО',           price: 75,  col: 'col_space',  desc: 'Таємничий корабель' },
        { id: 'a_saturn',  emoji: '🪐', name: 'Сатурн',        price: 85,  col: 'col_space',  desc: 'Планета з кільцями' },
        { id: 'a_robot',   emoji: '🤖', name: 'Робот-геній',   price: 60,  col: 'col_cyber',  desc: 'Штучний інтелект' },
        { id: 'a_cyborg',  emoji: '🦾', name: 'Кіборг',        price: 80,  col: 'col_cyber',  desc: 'Механічна рука' },
        { id: 'a_ninja',   emoji: '🥷', name: 'Ніндзя',        price: 70,  col: 'col_cyber',  desc: 'Тінь серед тіней' },
        { id: 'a_dragon',  emoji: '🐉', name: 'Кібер-дракон',  price: 110, col: 'col_cyber',  desc: 'Легендарний захисник' },
        { id: 'a_chip',    emoji: '💠', name: 'Кристал-чип',   price: 90,  col: 'col_cyber',  desc: 'Джерело енергії' },
        { id: 'a_wizard',  emoji: '🧙', name: 'Маг',           price: 80,  col: 'col_magic',  desc: 'Володар заклять' },
        { id: 'a_unicorn', emoji: '🦄', name: 'Єдиноріг',      price: 85,  col: 'col_magic',  desc: 'Магія та легенди' },
        { id: 'a_fairy',   emoji: '🧚', name: 'Фея',           price: 95,  col: 'col_magic',  desc: 'Дух природи' },
        { id: 'a_genie',   emoji: '🧞', name: 'Джин',          price: 105, col: 'col_magic',  desc: 'Виконавець бажань' },
        { id: 'a_phoenix', emoji: '🔥', name: 'Фенікс',        price: 130, col: 'col_magic',  desc: 'Вічно відроджується' }
    ],
    accessories: [
        { id: 'x_none',      emoji: '',   name: 'Немає',           price: 0,   slot: 'head' },
        { id: 'x_crown',     emoji: '👑', name: 'Корона',          price: 50,  slot: 'head' },
        { id: 'x_hat',       emoji: '🎩', name: 'Циліндр',         price: 30,  slot: 'head' },
        { id: 'x_partyhat',  emoji: '🎉', name: 'Святковий ковпак',price: 20,  slot: 'head' },
        { id: 'x_cap',       emoji: '🧢', name: 'Кепка',           price: 15,  slot: 'head' },
        { id: 'x_grad',      emoji: '🎓', name: 'Шапочка',         price: 40,  slot: 'head' },
        { id: 'x_beanie',    emoji: '🧣', name: 'Шарф',            price: 25,  slot: 'head' },
        { id: 'x_helmet',    emoji: '⛑️', name: 'Шолом',          price: 45,  slot: 'head' },
        { id: 'x_glasses',   emoji: '🕶️', name: 'Окуляри',         price: 25,  slot: 'eyes' },
        { id: 'x_goggles',   emoji: '🥽', name: 'Захисні окуляри', price: 35,  slot: 'eyes' },
        { id: 'x_monocle',   emoji: '🧐', name: 'Монокль',         price: 40,  slot: 'eyes' },
        { id: 'x_aura',      emoji: '✨', name: 'Сяйво',           price: 60,  slot: 'effect' },
        { id: 'x_fire',      emoji: '🔥', name: 'Полум\'я',        price: 70,  slot: 'effect' },
        { id: 'x_star',      emoji: '⭐', name: 'Зірки',           price: 45,  slot: 'effect' },
        { id: 'x_rainbow',   emoji: '🌈', name: 'Веселка',         price: 55,  slot: 'effect' },
        { id: 'x_lightning', emoji: '⚡', name: 'Блискавка',       price: 65,  slot: 'effect' },
        { id: 'x_heart',     emoji: '💖', name: 'Сердечка',        price: 40,  slot: 'effect' },
        { id: 'x_leaf',      emoji: '🍁', name: 'Осіннє листя',    price: 30,  slot: 'effect' },
        { id: 'x_snow',      emoji: '❄️', name: 'Сніжинки',        price: 35,  slot: 'effect' }
    ],
    themes: [
        { id: 'neon',    name: 'Неон',          price: 0,   desc: 'Базовий неон' },
        { id: 'pastel',  name: 'Пастель',       price: 0,   desc: 'Базовий пастель' },
        { id: 'space',   name: 'Космос',        price: 100, desc: 'Глибокий космос' },
        { id: 'cyber',   name: 'Кіберпанк',     price: 130, desc: 'Яскравий неон' },
        { id: 'forest',  name: 'Магічний ліс',  price: 110, desc: 'Зелений ліс' },
        { id: 'sunset',  name: 'Захід сонця',   price: 90,  desc: 'Теплі тони' },
        { id: 'ocean',   name: 'Океан',         price: 105, desc: 'Блакитні глибини' },
        { id: 'candy',   name: 'Цукеркова',     price: 80,  desc: 'Рожева тема' },
        { id: 'autumn',  name: 'Осінь',         price: 120, desc: 'Тепло багаття' }
    ]
};

/* ============================================================
   ЕМОДЗІ-РЕАКЦІЇ
   ============================================================ */
const REACTION_EMOJIS = ['🎉', '🔥', '👏', '🤔', '🚀', '😂', '😮', '💪', '❓', '💯'];

/* ============================================================
   БАЗИ ІМЕН
   ============================================================ */
const FIRST_NAMES_M = [
    'Андрій','Артем','Арсен','Богдан','Борис','Вадим','Валентин','Валерій','Василь','Віктор',
    'Віталій','Владислав','Володимир','Геннадій','Георгій','Григорій','Данило','Денис','Дмитро',
    'Євген','Єгор','Захар','Іван','Ігор','Ілля','Кирило','Костянтин','Леонід','Максим',
    'Марко','Микита','Микола','Мирон','Михайло','Назар','Нестор','Олег','Олександр','Олексій',
    'Остап','Павло','Петро','Роман','Руслан','Святослав','Сергій','Станіслав','Степан',
    'Тарас','Тимофій','Тимур','Юрій','Ярослав','Яків','Лука','Левко'
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

const BOT_NICKNAMES = [
    'Максим', 'Софія ✨', 'Оля', 'Артем', 'Катя 🌸', 'Назар', 'Мілана', 'Денис',
    'Владислава', 'Ілля 🚀', 'Дарина', 'Марко', 'Ніка', 'Тимур', 'Юлія 🌟',
    'Роман', 'Аліна', 'Богдан', 'Соломія', 'Микита', 'Поліна ✨', 'Захар',
    'Анастасія', 'Лука', 'Ангеліна', 'Остап', 'Христина', 'Левко', 'Каміла',
    'Ярослав', 'Марія', 'Григорій', 'Вікторія', 'Павло', 'Ярина'
];

const FUNNY_BOT_NAMES = [
    'Космо-Кіт 🐱', 'Ракетка 🚀', 'Зіронька ✨', 'Комета ☄️',
    'Сонячний Зайчик ☀️', 'Місячний Пельмень 🌙', 'Кібер-Хом\'як 🐹',
    'Піксель 👾', 'Байт 🤖', 'Дракончик 🐉', 'Весела Панда 🐼',
    'Мудра Сова 🦉', 'Блискавка ⚡', 'Космічна Овечка 🐑', 'Ласкава Лисичка 🦊',
    'Планетарій 🪐', 'Кристалик 💎', 'Вогник 🔥', 'Льодяник ❄️',
    'Чарівник 🧙', 'Єдиноріг 🦄', 'Кібер-Ніндзя 🥷', 'Робо-Пес 🦾',
    'Зоряний Пилосос 🌌', 'Міжгалактичний Песик 🐕', 'Магічна Черепашка 🐢',
    'Космо-Пінгвін 🐧', 'Вітамінка 🍊', 'Шоколадний Кіт 🍫'
];

const AVATARS = ['😀','😎','🤓','🥳','😺','🐶','🦊','🐼','🐨','🦁','🐯','🐸','🐵','🐧','🦄','🐙','🦖','🐉','🌟','⚡','🔥','🌈','🍀','🎈','🚀','🎨','🎮','⚽','🏆','💎','🍕','🍩'];

const MODES = {
    arcade:   { name: 'Аркада', multiplier: 1.0, defaultTime: 20 },
    survival: { name: 'Виживання', multiplier: 1.5, defaultTime: 15 },
    treasure: { name: 'Скарби', multiplier: 1.2, defaultTime: 25 }
};

/* ============================================================
   ДЕФОЛТНІ ДАНІ
   ============================================================ */
const DEFAULT_SUBJECTS = [
    'Математика', 'Українська мова', 'Історія',
    'Природознавство', 'Англійська мова', 'Мистецтво'
];

function defaultProfile() {
    return {
        coins: 0,
        xp: 0,
        ownedAvatars: ['a_cat', 'a_dog', 'a_fox'],
        ownedAccessories: ['x_none'],
        ownedThemes: ['neon', 'pastel'],
        equippedAvatar: 'a_cat',
        equippedHead: '',
        equippedEyes: '',
        equippedEffect: '',
        completedQuests: {}
    };
}

function defaultSchedule() {
    return {
        days: ['Понеділок', 'Вівторок', 'Середа', 'Четвер', 'П’ятниця'],
        lessons: [
            ['Математика', 'Українська мова', 'Природознавство', 'Фізкультура', 'Історія'],
            ['Українська мова', 'Англійська мова', 'Математика', 'Мистецтво', 'Природознавство'],
            ['Математика', 'Історія', 'Українська мова', 'Фізкультура', 'Англійська мова'],
            ['Природознавство', 'Математика', 'Українська мова', 'Історія', 'Мистецтво'],
            ['Англійська мова', 'Фізкультура', 'Математика', 'Українська мова', 'Класна година']
        ]
    };
}

function defaultHomework() {
    return [
        { subject: 'Математика',        task: 'С. 42, №5–8 (письмово)', due: 'завтра' },
        { subject: 'Українська мова',   task: 'Вправа 78, вивчити правило', due: 'завтра' },
        { subject: 'Історія',           task: 'Прочитати §12, відповісти на питання', due: 'через день' },
        { subject: 'Природознавство',   task: 'Спостереження за погодою', due: 'через 2 дні' },
        { subject: 'Англійська мова',   task: 'Вивчити 10 нових слів на тему «Школа»', due: 'завтра' }
    ];
}

/* ============================================================
   ГЕНЕРАЦІЯ ЛОГІНІВ ТА ПАРОЛІВ
   ============================================================ */
function generateLogin(name) {
    const map = {
        'а':'a','б':'b','в':'v','г':'g','ґ':'g','д':'d','е':'e','є':'ie','ж':'zh','з':'z',
        'и':'y','і':'i','ї':'i','й':'i','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p',
        'р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch',
        'ь':'','ю':'iu','я':'ia',' ':'','\'':'','-':''
    };
    let base = String(name || '').toLowerCase().split('').map(ch => map[ch] !== undefined ? map[ch] : ch).join('');
    base = base.replace(/[^a-z0-9]/g, '').slice(0, 14) || 'user';
    let login = base;
    let n = 1;
    while (DB.users[login]) {
        login = base + n;
        n++;
    }
    return login;
}

function generatePassword(len) {
    const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    let out = '';
    const L = len || 6;
    for (let i = 0; i < L; i++) {
        out += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return out;
}

/* ============================================================
   ІНІЦІАЛІЗАЦІЯ ВЧИТЕЛЯ
   ============================================================ */
(function initTeacher() {
    if (!DB.users['teacher']) {
        DB.users['teacher'] = {
            login: 'teacher',
            password: 'teacher123',
            name: 'Вчитель',
            role: 'teacher',
            classId: '5-А',
            createdAt: Date.now()
        };
        saveDB();
        console.log('[init] default teacher: teacher / teacher123');
    }
})();

/* ============================================================
   УТИЛІТИ
   ============================================================ */
function makeId(prefix) {
    return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
}

/* ============================================================
   ГЕНЕРАЦІЯ БОТІВ ДЛЯ ВІКТОРИНИ
   ============================================================ */
function generateBots(count) {
    const bots = [];
    const allFirst = FIRST_NAMES_M.concat(FIRST_NAMES_F);
    const poolFirst = shuffleArray(allFirst);
    const poolLast = shuffleArray(LAST_NAMES);
    const nickPool = shuffleArray(BOT_NICKNAMES);
    const funnyPool = shuffleArray(FUNNY_BOT_NAMES);
    const usedNames = new Set();

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
        } while (usedNames.has(full) && attempts < 80);
        usedNames.add(full);

        let nickname;
        if (nickPool.length > 0) {
            nickname = nickPool.shift();
        } else if (funnyPool.length > 0) {
            nickname = funnyPool.shift();
        } else {
            nickname = full;
        }

        bots.push({
            id: makeId('bot' + i),
            name: full,
            chatName: nickname,
            avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)],
            avatarId: 'a_cat',
            accessories: { head: '', eyes: '', effect: '' },
            score: 0,
            coins: 0,
            coinsEarnedThisGame: 0,
            finalPrize: 0,
            finalRank: 0,
            xp: 0,
            isBot: true,
            isCustomBot: false,
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
            quests: {}
        });
    }
    return bots;
}

/* ============================================================
   ЗМІШАНА ГЕНЕРАЦІЯ БОТІВ: КАСТОМНІ + ВИПАДКОВІ
   ------------------------------------------------------------
   customNames — масив імен, які вписує вчитель
   count — загальна кількість ботів, потрібних у грі
   ============================================================ */
function generateBotsMixed(count, customNames) {
    const bots = [];
    const customList = Array.isArray(customNames)
        ? customNames.map(s => String(s).trim()).filter(Boolean)
        : [];

    const usedCustom = new Set();
    customList.slice(0, count).forEach((name, i) => {
        const key = name.toLowerCase();
        if (usedCustom.has(key)) return;
        usedCustom.add(key);

        bots.push({
            id: makeId('cbot' + i),
            name: name,
            chatName: name,
            avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)],
            avatarId: 'a_cat',
            accessories: { head: '', eyes: '', effect: '' },
            score: 0,
            coins: 0,
            coinsEarnedThisGame: 0,
            finalPrize: 0,
            finalRank: 0,
            xp: 0,
            isBot: true,
            isCustomBot: true,
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
            quests: {}
        });
    });

    const remaining = Math.max(0, count - bots.length);
    if (remaining > 0) {
        const autoBots = generateBots(remaining);
        autoBots.forEach(b => bots.push(b));
    }

    return bots;
}

/* ============================================================
   ЛОГІКА КІМНАТИ ВІКТОРИНИ
   ============================================================ */
const rooms = new Map();

function generatePin() {
    for (let i = 0; i < 200; i++) {
        const pin = String(Math.floor(100000 + Math.random() * 900000));
        if (!rooms.has(pin)) return pin;
    }
    return String(Math.floor(100000 + Math.random() * 900000));
}

function addFeed(room, text) {
    if (!room.feed) room.feed = [];
    room.feed.unshift({ text: text, t: Date.now() });
    if (room.feed.length > 40) room.feed.length = 40;
}

function addChatMessage(room, opts) {
    if (!room.chat) room.chat = [];
    const msg = {
        id: makeId('msg'),
        from: opts.from || 'system',
        name: opts.name || 'Система',
        avatar: opts.avatar || '',
        avatarId: opts.avatarId || 'a_cat',
        accessories: opts.accessories || { head: '', eyes: '', effect: '' },
        text: String(opts.text || '').slice(0, 500),
        isBot: !!opts.isBot,
        t: Date.now()
    };
    room.chat.push(msg);
    if (room.chat.length > 150) room.chat.splice(0, room.chat.length - 150);
    return msg;
}

function broadcastChatMessage(room, msg) {
    io.to('room_' + room.pin).emit('chatMessage', msg);
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
            chatName: p.chatName || p.name,
            avatar: p.avatar,
            avatarId: p.avatarId,
            accessories: p.accessories,
            score: p.score,
            coins: p.coins,
            coinsEarnedThisGame: p.coinsEarnedThisGame || 0,
            finalPrize: p.finalPrize || 0,
            finalRank: p.finalRank || 0,
            xp: p.xp || 0,
            isBot: p.isBot,
            isCustomBot: p.isCustomBot || false,
            correctCount: p.correctCount,
            wrongCount: p.wrongCount,
            alive: p.alive,
            answeredThisRound: p.answeredThisRound,
            lastCorrect: p.lastCorrect,
            streak: p.streak || 0,
            bestStreak: p.bestStreak || 0,
            powerActive: p.powerActive || null,
            reaction: p.reaction || null
        })),
        feed: room.feed || [],
        chat: (room.chat || []).slice(-80)
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
            io.to('room_' + room.pin).emit('timeExpired', {
                questionIndex: room.currentQuestion
            });
        }
    }, 250);
}

function calculateRewards(opts) {
    const elapsed = opts.elapsed;
    const timePerQuestion = opts.timePerQuestion;
    const mode = opts.mode;
    const streak = opts.streak;
    const powerActive = opts.powerActive;
    const coinsEarnedThisGame = opts.coinsEarnedThisGame || 0;

    const timeBonus = Math.round(Math.max(0, 1 - elapsed / timePerQuestion) * ECONOMY.timeBonusMax);
    const modeMult = MODES[mode] ? MODES[mode].multiplier : 1.0;

    let streakMultScore = 1.0;
    const scoreKeys = Object.keys(ECONOMY.streakScoreMultiplier).map(Number).sort((a, b) => b - a);
    for (let i = 0; i < scoreKeys.length; i++) {
        if (streak >= scoreKeys[i]) { streakMultScore = ECONOMY.streakScoreMultiplier[scoreKeys[i]]; break; }
    }
    const powerMult = (powerActive && powerActive.type === 'double') ? 2 : 1;
    const gainedScore = Math.round((ECONOMY.baseScore + timeBonus) * modeMult * streakMultScore * powerMult);

    let coins = ECONOMY.coinsCorrect;
    let speedBonus = 0;
    if ((elapsed / timePerQuestion) <= 0.25) {
        speedBonus = ECONOMY.coinsSpeedBonus;
        coins += speedBonus;
    }
    const cap = ECONOMY.coinsPerGameCap;
    const remaining = Math.max(0, cap - coinsEarnedThisGame);
    if (coins > remaining) coins = remaining;

    const gainedXp = Math.round(gainedScore / 10);
    return {
        score: gainedScore,
        coins: coins,
        xp: gainedXp,
        breakdown: { timeBonus, modeMult, streakMultScore, speedBonus, powerMult, cap, alreadyEarned: coinsEarnedThisGame, remaining }
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
                    elapsed, timePerQuestion: room.timePerQuestion, mode: room.mode,
                    streak: p.streak, powerActive: p.powerActive,
                    coinsEarnedThisGame: p.coinsEarnedThisGame || 0
                });
                p.score += rewards.score;
                p.coins = (p.coins || 0) + rewards.coins;
                p.coinsEarnedThisGame = (p.coinsEarnedThisGame || 0) + rewards.coins;
                p.xp = (p.xp || 0) + rewards.xp;
                addFeed(room, '✅ ' + p.name + ' правильно (+' + rewards.score + ' балів, +' + rewards.coins + ' 🪙)');
                p.powerActive = null;
            } else {
                p.wrongCount++;
                p.streak = 0;
                if (room.mode === 'survival' && p.wrongCount >= 3) {
                    p.alive = false;
                    addFeed(room, '💤 ' + p.name + ' вибуває');
                }
            }
            broadcastState(room);
        }, delayMs);
    });
}

/* ============================================================
   AI-БОТИ В ЧАТІ
   ============================================================ */
const FALLBACK_AI_REPLIES = [
    'О, цікаво! 😊',
    'Згоден 👍',
    'Добре сказано! ✨',
    'Розумію тебе 📚',
    'Класно, що ти поділився 😊',
    'Ага, я теж так думаю 👍',
    'Оце так! Цікаво 😊',
    'Дякую, що написав ✨',
    'Звучить добре 📚',
    'Ти гарно пишеш 😊',
    'Класна думка! 🌟',
    'Погоджуюсь 👍'
];

async function generateAIReply(room, userMessage) {
    const text = String(userMessage.text || '').trim();
    if (!text) return null;

    const history = (room.chat || []).slice(-10).map(m => ({
        text: m.text,
        isBot: m.isBot
    }));

    if (GEMINI_API_KEY) {
        const aiText = await callGeminiChat(history, text);
        if (aiText) return aiText;
    }

    return FALLBACK_AI_REPLIES[Math.floor(Math.random() * FALLBACK_AI_REPLIES.length)];
}

function scheduleBotChatReactions(room, userMessage) {
    if (!room || room.status === 'finished') return;
    if (!room.chatBotsEnabled) return;
    const bots = room.players.filter(p => p.isBot);
    if (bots.length === 0) return;

    const maxResponders = Math.min(bots.length, 1 + Math.floor(Math.random() * 2));
    const responders = [];
    const pool = bots.slice();
    for (let i = 0; i < maxResponders; i++) {
        if (pool.length === 0) break;
        const idx = Math.floor(Math.random() * pool.length);
        responders.push(pool.splice(idx, 1)[0]);
    }

    responders.forEach((bot, i) => {
        const delay = 800 + i * 600 + Math.floor(Math.random() * 1200);
        setTimeout(async () => {
            if (!rooms.has(room.pin)) return;
            if (room.status === 'finished') return;
            if (!room.chatBotsEnabled) return;

            let reply = await generateAIReply(room, userMessage);
            if (!reply) reply = FALLBACK_AI_REPLIES[Math.floor(Math.random() * FALLBACK_AI_REPLIES.length)];
            reply = sanitizeAIOutput(reply);

            const msg = addChatMessage(room, {
                from: bot.id,
                name: bot.chatName || bot.name,
                avatar: bot.avatar,
                avatarId: bot.avatarId,
                accessories: bot.accessories,
                text: reply,
                isBot: true
            });
            broadcastChatMessage(room, msg);
        }, delay);
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
    cors: { origin: '*', methods: ['GET', 'POST'], credentials: false },
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
        reactions: REACTION_EMOJIS,
        aiEnabled: !!GEMINI_API_KEY
    });
});

app.get('/api/health', (req, res) => {
    res.json({
        ok: true,
        rooms: rooms.size,
        users: Object.keys(DB.users).length,
        bots: Array.isArray(DB.bots) ? DB.bots.length : 0,
        gemini: !!GEMINI_API_KEY,
        uptime: Math.round(process.uptime()),
        node: process.version
    });
});

/* Авторизація */
app.post('/api/login', (req, res) => {
    try {
        const login = String((req.body && req.body.login) || '').trim().toLowerCase();
        const password = String((req.body && req.body.password) || '');
        if (!login || !password) {
            return res.json({ ok: false, error: 'Введи логін і пароль' });
        }
        const user = DB.users[login];
        if (!user || user.password !== password) {
            return res.json({ ok: false, error: 'Невірний логін або пароль' });
        }

        const profile = user.profile || defaultProfile();
        const grades = DB.grades[login] || { subjects: DEFAULT_SUBJECTS.slice(), rows: [] };
        const schedule = DB.schedule[login] || defaultSchedule();
        const homework = DB.homework[login] || defaultHomework();

        res.json({
            ok: true,
            user: {
                login: user.login,
                name: user.name,
                role: user.role,
                classId: user.classId || '5-А',
                profile,
                grades,
                schedule,
                homework
            }
        });
    } catch (e) {
        res.json({ ok: false, error: 'Помилка входу' });
    }
});

/* Створення одного учня */
app.post('/api/teacher/create-student', (req, res) => {
    try {
        const teacherLogin = String((req.body && req.body.teacherLogin) || '').trim().toLowerCase();
        const teacherPassword = String((req.body && req.body.teacherPassword) || '');
        const studentName = String((req.body && req.body.studentName) || '').trim();
        const classId = String((req.body && req.body.classId) || '5-А').trim();

        const teacher = DB.users[teacherLogin];
        if (!teacher || teacher.role !== 'teacher' || teacher.password !== teacherPassword) {
            return res.json({ ok: false, error: 'Немає прав вчителя' });
        }
        if (studentName.length < 2) return res.json({ ok: false, error: 'Введи ім\'я учня' });

        const login = generateLogin(studentName);
        const password = generatePassword(6);

        DB.users[login] = {
            login,
            password,
            name: studentName,
            role: 'student',
            classId,
            createdAt: Date.now(),
            profile: defaultProfile()
        };
        DB.grades[login] = { subjects: DEFAULT_SUBJECTS.slice(), rows: [] };
        DB.schedule[login] = defaultSchedule();
        DB.homework[login] = defaultHomework();
        saveDB();

        res.json({
            ok: true,
            student: { login, password, name: studentName, classId }
        });
    } catch (e) {
        res.json({ ok: false, error: 'Помилка створення' });
    }
});

/* Масове створення учнів */
app.post('/api/teacher/create-students-bulk', (req, res) => {
    try {
        const teacherLogin = String((req.body && req.body.teacherLogin) || '').trim().toLowerCase();
        const teacherPassword = String((req.body && req.body.teacherPassword) || '');
        const classId = String((req.body && req.body.classId) || '5-А').trim();
        const namesRaw = String((req.body && req.body.names) || '');

        const teacher = DB.users[teacherLogin];
        if (!teacher || teacher.role !== 'teacher' || teacher.password !== teacherPassword) {
            return res.json({ ok: false, error: 'Немає прав вчителя' });
        }

        const names = namesRaw
            .split(/\r?\n|,|;/)
            .map(s => s.trim())
            .filter(s => s.length >= 2);

        if (names.length === 0) return res.json({ ok: false, error: 'Немає імен' });

        const created = [];
        names.forEach(name => {
            const login = generateLogin(name);
            const password = generatePassword(6);
            DB.users[login] = {
                login, password, name,
                role: 'student', classId,
                createdAt: Date.now(),
                profile: defaultProfile()
            };
            DB.grades[login] = { subjects: DEFAULT_SUBJECTS.slice(), rows: [] };
            DB.schedule[login] = defaultSchedule();
            DB.homework[login] = defaultHomework();
            created.push({ login, password, name, classId });
        });
        saveDB();
        res.json({ ok: true, students: created });
    } catch (e) {
        res.json({ ok: false, error: 'Помилка створення' });
    }
});

/* Список учнів */
app.post('/api/teacher/list-students', (req, res) => {
    try {
        const teacherLogin = String((req.body && req.body.teacherLogin) || '').trim().toLowerCase();
        const teacherPassword = String((req.body && req.body.teacherPassword) || '');
        const teacher = DB.users[teacherLogin];
        if (!teacher || teacher.role !== 'teacher' || teacher.password !== teacherPassword) {
            return res.json({ ok: false, error: 'Немає прав вчителя' });
        }
        const list = [];
        for (const login in DB.users) {
            const u = DB.users[login];
            if (u.role === 'student') {
                list.push({ login: u.login, name: u.name, classId: u.classId || '5-А' });
            }
        }
        res.json({ ok: true, students: list });
    } catch (e) {
        res.json({ ok: false, error: 'Помилка' });
    }
});

/* Виставлення оцінки */
app.post('/api/teacher/set-grade', (req, res) => {
    try {
        const teacherLogin = String((req.body && req.body.teacherLogin) || '').trim().toLowerCase();
        const teacherPassword = String((req.body && req.body.teacherPassword) || '');
        const studentLogin = String((req.body && req.body.studentLogin) || '').trim().toLowerCase();
        const subject = String((req.body && req.body.subject) || '').trim();
        const grade = parseInt(req.body && req.body.grade, 10);

        const teacher = DB.users[teacherLogin];
        if (!teacher || teacher.role !== 'teacher' || teacher.password !== teacherPassword) {
            return res.json({ ok: false, error: 'Немає прав' });
        }
        const student = DB.users[studentLogin];
        if (!student || student.role !== 'student') {
            return res.json({ ok: false, error: 'Учня не знайдено' });
        }
        if (!subject || !(grade >= 1 && grade <= 12)) {
            return res.json({ ok: false, error: 'Некоректна оцінка або предмет' });
        }
        if (!DB.grades[studentLogin]) {
            DB.grades[studentLogin] = { subjects: DEFAULT_SUBJECTS.slice(), rows: [] };
        }
        const dateStr = new Date().toISOString().slice(0, 10);
        DB.grades[studentLogin].rows.push({ subject, grade, date: dateStr });
        if (DB.grades[studentLogin].rows.length > 500) {
            DB.grades[studentLogin].rows = DB.grades[studentLogin].rows.slice(-500);
        }
        saveDB();
        res.json({ ok: true });
    } catch (e) {
        res.json({ ok: false, error: 'Помилка' });
    }
});

/* ДЗ для всіх учнів */
app.post('/api/teacher/set-homework', (req, res) => {
    try {
        const teacherLogin = String((req.body && req.body.teacherLogin) || '').trim().toLowerCase();
        const teacherPassword = String((req.body && req.body.teacherPassword) || '');
        const teacher = DB.users[teacherLogin];
        if (!teacher || teacher.role !== 'teacher' || teacher.password !== teacherPassword) {
            return res.json({ ok: false, error: 'Немає прав' });
        }
        const subject = String((req.body && req.body.subject) || '').trim();
        const task = String((req.body && req.body.task) || '').trim();
        const due = String((req.body && req.body.due) || '').trim();
        if (!subject || !task) return res.json({ ok: false, error: 'Заповни предмет і завдання' });

        for (const login in DB.users) {
            const u = DB.users[login];
            if (u.role === 'student') {
                if (!DB.homework[login]) DB.homework[login] = defaultHomework();
                DB.homework[login].unshift({
                    subject, task, due: due || 'найближчим часом'
                });
                if (DB.homework[login].length > 30) DB.homework[login].length = 30;
            }
        }
        saveDB();
        res.json({ ok: true });
    } catch (e) {
        res.json({ ok: false, error: 'Помилка' });
    }
});

/* Розклад */
app.post('/api/teacher/set-schedule', (req, res) => {
    try {
        const teacherLogin = String((req.body && req.body.teacherLogin) || '').trim().toLowerCase();
        const teacherPassword = String((req.body && req.body.teacherPassword) || '');
        const teacher = DB.users[teacherLogin];
        if (!teacher || teacher.role !== 'teacher' || teacher.password !== teacherPassword) {
            return res.json({ ok: false, error: 'Немає прав' });
        }
        const studentLogin = String((req.body && req.body.studentLogin) || '').trim().toLowerCase();
        const schedule = req.body && req.body.schedule;

        if (studentLogin && DB.users[studentLogin] && DB.users[studentLogin].role === 'student') {
            if (schedule && Array.isArray(schedule.days) && Array.isArray(schedule.lessons)) {
                DB.schedule[studentLogin] = schedule;
            }
        } else {
            for (const login in DB.users) {
                if (DB.users[login].role === 'student' && schedule && Array.isArray(schedule.days) && Array.isArray(schedule.lessons)) {
                    DB.schedule[login] = schedule;
                }
            }
        }
        saveDB();
        res.json({ ok: true });
    } catch (e) {
        res.json({ ok: false, error: 'Помилка' });
    }
});

/* ============================================================
   БОТИ — REST API
   ============================================================ */
app.post('/api/teacher/add-bots', (req, res) => {
    try {
        const teacherLogin = String((req.body && req.body.teacherLogin) || '').trim().toLowerCase();
        const teacherPassword = String((req.body && req.body.teacherPassword) || '');
        const raw = String((req.body && req.body.names) || '');

        const teacher = DB.users[teacherLogin];
        if (!teacher || teacher.role !== 'teacher' || teacher.password !== teacherPassword) {
            return res.json({ ok: false, error: 'Немає прав вчителя' });
        }

        const names = raw
            .split(/\r?\n|,|;/)
            .map(s => s.trim())
            .filter(s => s.length >= 2);

        if (names.length === 0) return res.json({ ok: false, error: 'Немає імен' });

        if (!Array.isArray(DB.bots)) DB.bots = [];
        const added = [];
        let skipped = 0;
        names.forEach(name => {
            const exists = DB.bots.find(b => b.name.toLowerCase() === name.toLowerCase());
            if (exists) { skipped++; return; }
            const bot = {
                id: 'bot_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                name: name,
                createdAt: Date.now()
            };
            DB.bots.push(bot);
            added.push(bot);
        });
        saveDB();
        res.json({ ok: true, added, skipped, total: DB.bots.length });
    } catch (e) {
        res.json({ ok: false, error: 'Помилка' });
    }
});

app.post('/api/teacher/list-bots', (req, res) => {
    try {
        const teacherLogin = String((req.body && req.body.teacherLogin) || '').trim().toLowerCase();
        const teacherPassword = String((req.body && req.body.teacherPassword) || '');
        const teacher = DB.users[teacherLogin];
        if (!teacher || teacher.role !== 'teacher' || teacher.password !== teacherPassword) {
            return res.json({ ok: false, error: 'Немає прав вчителя' });
        }
        res.json({ ok: true, bots: Array.isArray(DB.bots) ? DB.bots : [] });
    } catch (e) {
        res.json({ ok: false, error: 'Помилка' });
    }
});

app.post('/api/teacher/delete-bot', (req, res) => {
    try {
        const teacherLogin = String((req.body && req.body.teacherLogin) || '').trim().toLowerCase();
        const teacherPassword = String((req.body && req.body.teacherPassword) || '');
        const botId = String((req.body && req.body.botId) || '');
        const teacher = DB.users[teacherLogin];
        if (!teacher || teacher.role !== 'teacher' || teacher.password !== teacherPassword) {
            return res.json({ ok: false, error: 'Немає прав вчителя' });
        }
        if (!Array.isArray(DB.bots)) DB.bots = [];
        DB.bots = DB.bots.filter(b => b.id !== botId);
        saveDB();
        res.json({ ok: true, total: DB.bots.length });
    } catch (e) {
        res.json({ ok: false, error: 'Помилка' });
    }
});

app.post('/api/teacher/clear-bots', (req, res) => {
    try {
        const teacherLogin = String((req.body && req.body.teacherLogin) || '').trim().toLowerCase();
        const teacherPassword = String((req.body && req.body.teacherPassword) || '');
        const teacher = DB.users[teacherLogin];
        if (!teacher || teacher.role !== 'teacher' || teacher.password !== teacherPassword) {
            return res.json({ ok: false, error: 'Немає прав вчителя' });
        }
        DB.bots = [];
        saveDB();
        res.json({ ok: true });
    } catch (e) {
        res.json({ ok: false, error: 'Помилка' });
    }
});

/* Оновлення профілю */
app.post('/api/user/profile', (req, res) => {
    try {
        const login = String((req.body && req.body.login) || '').trim().toLowerCase();
        const password = String((req.body && req.body.password) || '');
        const user = DB.users[login];
        if (!user || user.password !== password) return res.json({ ok: false, error: 'Немає прав' });
        if (req.body && req.body.profile && typeof req.body.profile === 'object') {
            user.profile = Object.assign(defaultProfile(), req.body.profile);
            saveDB();
        }
        res.json({ ok: true, profile: user.profile });
    } catch (e) {
        res.json({ ok: false, error: 'Помилка' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get(/^\/(?!socket\.io|api\/).*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ============================================================
   SOCKET.IO
   ============================================================ */
io.on('connection', (socket) => {
    console.log('[connect]', socket.id, '| transport:', socket.conn.transport.name);

    let currentRoomPin = null;
    let role = null;
    let currentUserLogin = null;

    socket.conn.on('upgrade', () => {
        console.log('[upgrade]', socket.id, '→', socket.conn.transport.name);
    });

    socket.on('getShop', (cb) => {
        if (cb) cb({
            ok: true,
            shop: SHOP,
            economy: ECONOMY,
            quests: QUEST_DEFS,
            reactions: REACTION_EMOJIS,
            aiEnabled: !!GEMINI_API_KEY
        });
    });

    socket.on('auth', (payload, cb) => {
        try {
            const login = String(payload && payload.login || '').trim().toLowerCase();
            const password = String(payload && payload.password || '');
            const user = DB.users[login];
            if (!user || user.password !== password) {
                if (cb) cb({ ok: false, error: 'Невірний логін або пароль' });
                return;
            }
            currentUserLogin = login;
            if (cb) cb({
                ok: true,
                user: {
                    login: user.login,
                    name: user.name,
                    role: user.role,
                    classId: user.classId || '5-А'
                }
            });
        } catch (e) {
            if (cb) cb({ ok: false, error: 'Помилка авторизації' });
        }
    });

    /* ---------- ШКІЛЬНИЙ ЧАТ ---------- */
    socket.on('classChatMessage', (payload, cb) => {
        try {
            const text = String(payload && payload.text || '').trim().slice(0, 400);
            if (!text) {
                if (cb) cb({ ok: false, error: 'Порожнє повідомлення' });
                return;
            }

            const botCount = 1 + Math.floor(Math.random() * 2);
            const replies = [];
            const chatBots = BOT_NICKNAMES.slice();
            const avatars = AVATARS.slice();

            for (let i = 0; i < botCount; i++) {
                replies.push({
                    name: chatBots[Math.floor(Math.random() * chatBots.length)],
                    avatar: avatars[Math.floor(Math.random() * avatars.length)],
                    text: FALLBACK_AI_REPLIES[Math.floor(Math.random() * FALLBACK_AI_REPLIES.length)]
                });
            }

            if (GEMINI_API_KEY) {
                callGeminiChat([], text).then(aiText => {
                    if (aiText) {
                        replies[0].text = aiText;
                    }
                    if (cb) cb({ ok: true, replies });
                }).catch(() => {
                    if (cb) cb({ ok: true, replies });
                });
            } else {
                if (cb) cb({ ok: true, replies });
            }
        } catch (e) {
            if (cb) cb({ ok: false, error: 'Помилка' });
        }
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
            const chatBotsEnabled = payload.chatBotsEnabled !== false;
            const customBotNames = Array.isArray(payload.customBotNames)
                ? payload.customBotNames.map(s => String(s).trim()).filter(Boolean)
                : [];

            const pin = generatePin();
            const bots = generateBotsMixed(botCount, customBotNames);

            const room = {
                pin, createdAt: Date.now(), status: 'lobby', mode, timePerQuestion,
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
                chat: [],
                reactions: [],
                firstAnswer: null,
                chatBotsEnabled,
                customBotNames: customBotNames,
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

            const customCount = bots.filter(b => b.isCustomBot).length;
            const autoCount = bots.length - customCount;
            let feedMsg = 'Кімнату створено. Запрошуйте учнів! 📚';
            if (bots.length > 0) {
                feedMsg += ' (ботів: ' + bots.length;
                if (customCount > 0) feedMsg += ', з них кастомних: ' + customCount;
                if (autoCount > 0) feedMsg += ', автогенерованих: ' + autoCount;
                feedMsg += ')';
            }
            addFeed(room, feedMsg);

            if (chatBotsEnabled && bots.length > 0) {
                setTimeout(() => {
                    if (!rooms.has(pin)) return;
                    const bot = bots[Math.floor(Math.random() * bots.length)];
                    const msg = addChatMessage(room, {
                        from: bot.id, name: bot.chatName || bot.name,
                        avatar: bot.avatar, avatarId: bot.avatarId, accessories: bot.accessories,
                        text: 'Привіт усім! Хто сьогодні грає? 😊',
                        isBot: true
                    });
                    broadcastChatMessage(room, msg);
                }, 2200);
            }

            if (cb) cb({ ok: true, pin, state: getPublicState(room) });
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
            const login = String(payload && payload.login || '').trim().toLowerCase();
            const password = String(payload && payload.password || '');
            const avatarId = String(payload && payload.avatarId || 'a_cat');
            const accessories = (payload && payload.accessories) || { head: '', eyes: '', effect: '' };

            if (!/^\d{6}$/.test(pin)) { if (cb) cb({ ok: false, error: 'Невірний PIN' }); return; }
            const user = DB.users[login];
            if (!user || user.password !== password) {
                if (cb) cb({ ok: false, error: 'Невірний логін або пароль' });
                return;
            }
            if (user.role !== 'student') {
                if (cb) cb({ ok: false, error: 'Тільки учні можуть приєднуватись' });
                return;
            }
            const room = rooms.get(pin);
            if (!room) { if (cb) cb({ ok: false, error: 'Кімнату не знайдено' }); return; }
            if (room.status === 'finished') { if (cb) cb({ ok: false, error: 'Гра завершена' }); return; }

            let avatarEmoji = '😀';
            const found = SHOP.avatars.find(a => a.id === avatarId);
            if (found) avatarEmoji = found.emoji;

            const existing = room.players.find(p => !p.isBot && p.login === login);
            let player;
            if (existing) {
                existing.avatarId = avatarId;
                existing.avatar = avatarEmoji;
                existing.accessories = accessories;
                existing.socketId = socket.id;
                player = existing;
                addFeed(room, '🔄 ' + user.name + ' повернувся(лась)');
            } else {
                const prof = user.profile || defaultProfile();
                player = {
                    id: makeId('pl'),
                    login: user.login,
                    name: user.name,
                    chatName: user.name,
                    avatar: avatarEmoji,
                    avatarId,
                    accessories,
                    score: 0,
                    coins: prof.coins || 0,
                    coinsEarnedThisGame: 0,
                    finalPrize: 0,
                    finalRank: 0,
                    xp: prof.xp || 0,
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
                    chatCount: 0
                };
                room.players.push(player);
                addFeed(room, '👋 ' + user.name + ' приєднався(лась)');
                if (room.chatBotsEnabled) {
                    const bots = room.players.filter(p => p.isBot);
                    if (bots.length > 0) {
                        const bot = bots[Math.floor(Math.random() * bots.length)];
                        setTimeout(() => {
                            if (!rooms.has(pin)) return;
                            const greet = addChatMessage(room, {
                                from: bot.id, name: bot.chatName || bot.name,
                                avatar: bot.avatar, avatarId: bot.avatarId, accessories: bot.accessories,
                                text: 'Привіт, ' + user.name + '! Радий(а) тебе бачити 😊',
                                isBot: true
                            });
                            broadcastChatMessage(room, greet);
                        }, 900 + Math.floor(Math.random() * 1000));
                    }
                }
            }

            currentRoomPin = pin;
            role = 'student';
            currentUserLogin = login;
            socket.join('room_' + pin);

            if (cb) cb({ ok: true, playerId: player.id, state: getPublicState(room) });
            broadcastState(room);
        } catch (err) {
            console.error('joinRoom error', err);
            if (cb) cb({ ok: false, error: 'Помилка входу' });
        }
    });

    socket.on('updateProfile', (payload) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room) return;
            const player = room.players.find(p => p.id === payload.playerId);
            if (!player) return;
            if (payload.avatarId) {
                player.avatarId = payload.avatarId;
                const a = SHOP.avatars.find(x => x.id === payload.avatarId);
                if (a) player.avatar = a.emoji;
            }
            if (payload.accessories) player.accessories = payload.accessories;
            if (typeof payload.xp === 'number') player.xp = payload.xp;
            broadcastState(room);
        } catch (e) { }
    });

    socket.on('sendChat', (payload, cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room) { if (cb) cb({ ok: false }); return; }
            const player = room.players.find(p => p.id === payload.playerId);
            if (!player) { if (cb) cb({ ok: false }); return; }

            const text = String(payload.text || '').trim().slice(0, 500);
            if (!text) { if (cb) cb({ ok: false, error: 'Порожнє повідомлення' }); return; }

            const now = Date.now();
            if (player.lastChatAt && (now - player.lastChatAt) < 700) {
                if (cb) cb({ ok: false, error: 'Зачекай трохи' }); return;
            }
            player.lastChatAt = now;

            const msg = addChatMessage(room, {
                from: player.id, name: player.chatName || player.name,
                avatar: player.avatar, avatarId: player.avatarId, accessories: player.accessories,
                text, isBot: false
            });
            broadcastChatMessage(room, msg);

            if (!player.isBot) {
                player.chatCount = (player.chatCount || 0) + 1;
                if (!player.quests) player.quests = {};
                if (!player.quests.chat_master && player.chatCount >= 5) {
                    player.quests.chat_master = { completed: true, t: Date.now(), pendingReward: QUEST_DEFS.chat_master.reward };
                }
            }
            if (cb) cb({ ok: true });
            scheduleBotChatReactions(room, msg);
        } catch (err) {
            console.error('sendChat error', err);
            if (cb) cb({ ok: false });
        }
    });

    socket.on('startGame', (cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room || room.teacherSocketId !== socket.id) { if (cb) cb({ ok: false }); return; }
            if (room.status === 'running') { if (cb) cb({ ok: false }); return; }

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

    socket.on('nextQuestion', (cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room || room.teacherSocketId !== socket.id) { if (cb) cb({ ok: false }); return; }
            if (room.status !== 'running') { if (cb) cb({ ok: false }); return; }
            if (room.currentQuestion + 1 >= room.questions.length) { if (cb) cb({ ok: false }); return; }

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
            if (cb) cb({ ok: true });
            broadcastState(room);
        } catch (err) {
            console.error('nextQuestion error', err);
            if (cb) cb({ ok: false });
        }
    });

    socket.on('answer', (payload, cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room || room.status !== 'running') { if (cb) cb({ ok: false }); return; }
            const qIndex = parseInt(payload && payload.q, 10);
            const aIndex = parseInt(payload && payload.a, 10);
            const playerId = payload && payload.playerId;
            if (qIndex !== room.currentQuestion) { if (cb) cb({ ok: false }); return; }
            const player = room.players.find(p => p.id === playerId);
            if (!player || player.answeredThisRound || !player.alive) { if (cb) cb({ ok: false }); return; }
            const q = room.questions[room.currentQuestion];
            if (!q) { if (cb) cb({ ok: false }); return; }
            const isCorrect = (aIndex === q.correct);
            player.answeredThisRound = true;
            player.lastCorrect = isCorrect;
            const elapsed = (Date.now() - room.questionStartedAt) / 1000;
            if (!room.firstAnswer) room.firstAnswer = player.id;

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
                addFeed(room, '✅ ' + player.name + ' правильно (+' + rewards.score + ' балів, +' + rewards.coins + ' 🪙)');
                player.powerActive = null;

                if (!player.isBot && player.login) {
                    const u = DB.users[player.login];
                    if (u) {
                        if (!u.profile) u.profile = defaultProfile();
                        u.profile.coins = player.coins;
                        u.profile.xp = player.xp;
                        saveDB();
                    }
                }
            } else {
                player.wrongCount++;
                player.streak = 0;
                addFeed(room, '❌ ' + player.name + ' помилився(лась)');
                if (room.mode === 'survival' && player.wrongCount >= 3) {
                    player.alive = false;
                    addFeed(room, '💤 ' + player.name + ' вибуває');
                }
            }
            if (cb) cb({
                ok: true, isCorrect, score: player.score, coins: player.coins,
                coinsEarnedThisGame: player.coinsEarnedThisGame || 0,
                xp: player.xp, streak: player.streak
            });
            broadcastState(room);
        } catch (err) {
            console.error('answer error', err);
            if (cb) cb({ ok: false });
        }
    });

    socket.on('activatePower', (payload, cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room || room.status !== 'running') { if (cb) cb({ ok: false }); return; }
            const player = room.players.find(p => p.id === payload.playerId);
            if (!player || (player.streak || 0) < 3 || player.powerActive) { if (cb) cb({ ok: false }); return; }
            const type = String(payload.type || 'double');
            if (!['double', 'shield', 'reveal'].includes(type)) { if (cb) cb({ ok: false }); return; }
            player.powerActive = { type, at: Date.now() };
            addFeed(room, '⚡ ' + player.name + ' активував(ла) суперсилу');
            if (type === 'shield') room.questionStartedAt += 5000;
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

    socket.on('sendReaction', (payload, cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room) { if (cb) cb({ ok: false }); return; }
            const player = room.players.find(p => p.id === payload.playerId);
            if (!player) { if (cb) cb({ ok: false }); return; }
            const emoji = String(payload.emoji || '').slice(0, 4);
            if (!REACTION_EMOJIS.includes(emoji)) { if (cb) cb({ ok: false }); return; }
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
        } catch (err) {
            console.error('sendReaction error', err);
            if (cb) cb({ ok: false });
        }
    });

    socket.on('finishGame', (cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room || room.teacherSocketId !== socket.id) { if (cb) cb({ ok: false }); return; }
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
                if (!p.isBot && p.login) {
                    const u = DB.users[p.login];
                    if (u) {
                        if (!u.profile) u.profile = defaultProfile();
                        u.profile.coins = p.coins;
                        saveDB();
                    }
                }
            });
            addFeed(room, '🏁 Гру завершено!');
            if (ranked[0]) addFeed(room, '🥇 ' + ranked[0].name + ' — 1 місце (+' + getFinalPrize(1) + ' 🪙)');
            if (ranked[1]) addFeed(room, '🥈 ' + ranked[1].name + ' — 2 місце (+' + getFinalPrize(2) + ' 🪙)');
            if (ranked[2]) addFeed(room, '🥉 ' + ranked[2].name + ' — 3 місце (+' + getFinalPrize(3) + ' 🪙)');
            if (cb) cb({ ok: true });
            broadcastState(room);
            io.to('room_' + room.pin).emit('gameOver');
            room.cleanupTimer = setTimeout(() => {
                const r = rooms.get(room.pin);
                if (r && r.status === 'finished') { cleanupRoom(r); rooms.delete(room.pin); }
            }, 15 * 60 * 1000);
        } catch (err) {
            console.error('finishGame error', err);
            if (cb) cb({ ok: false });
        }
    });

    socket.on('closeRoom', (cb) => {
        try {
            const room = rooms.get(currentRoomPin);
            if (!room || room.teacherSocketId !== socket.id) { if (cb) cb({ ok: false }); return; }
            io.to('room_' + room.pin).emit('roomClosed');
            cleanupRoom(room);
            rooms.delete(room.pin);
            if (cb) cb({ ok: true });
        } catch (err) {
            console.error('closeRoom error', err);
            if (cb) cb({ ok: false });
        }
    });

    socket.on('reconnectTeacher', (payload, cb) => {
        try {
            const pin = String(payload && payload.pin || '').trim();
            const room = rooms.get(pin);
            if (!room) { if (cb) cb({ ok: false }); return; }
            if (room.teacherDisconnectTimer) { clearTimeout(room.teacherDisconnectTimer); room.teacherDisconnectTimer = null; }
            room.teacherSocketId = socket.id;
            currentRoomPin = pin;
            role = 'teacher';
            socket.join('room_' + pin);
            if (cb) cb({ ok: true, state: getPublicState(room) });
            broadcastState(room);
        } catch (err) {
            if (cb) cb({ ok: false });
        }
    });

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

/* ============================================================
   АВТООЧИЩЕННЯ КІМНАТ
   ============================================================ */
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [pin, room] of rooms) {
        const noHuman = room.players.filter(p => !p.isBot).length === 0;
        const oldLobby = noHuman && now - room.createdAt > 2 * 60 * 60 * 1000;
        const oldFinished = room.status === 'finished' && room.finishedAt && now - room.finishedAt > 60 * 60 * 1000;
        if (oldLobby || oldFinished) {
            cleanupRoom(room);
            rooms.delete(pin);
            cleaned++;
        }
    }
    if (cleaned > 0) console.log('[cleanup] removed', cleaned, '| total:', rooms.size);
}, 5 * 60 * 1000);

/* ============================================================
   СТАРТ СЕРВЕРА
   ============================================================ */
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

httpServer.listen(PORT, HOST, () => {
    console.log('==============================================');
    console.log('🌟 SunLorem: Інтерактивна шкільна система');
    console.log('🚀 Сервер слухає на ' + HOST + ':' + PORT);
    console.log('🔌 Socket.io path = /socket.io/');
    console.log('🛒 Магазин: /api/shop');
    console.log('🤖 Gemini AI: ' + (GEMINI_API_KEY ? 'увімкнено' : 'ВИМКНЕНО (немає GEMINI_API_KEY)'));
    console.log('👩‍🏫 Вчитель: teacher / teacher123');
    console.log('💾 Дані: ' + DATA_FILE);
    console.log('🤖 Ботів у базі: ' + (Array.isArray(DB.bots) ? DB.bots.length : 0));
    console.log('==============================================');
});

function gracefulShutdown(signal) {
    console.log('[shutdown]', signal);
    saveDBImmediate();
    io.close(() => httpServer.close(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
