const express = require('express');
const session = require('express-session');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const fetch = require('node-fetch');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');

// ==== Google Gemini API key (встав свій ключ, якщо хочеш реальний AI) ====
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// ============== Сховище даних ==============
function defaultData() {
  return {
    users: {
      teacher: {
        id: 'teacher',
        username: 'teacher',
        password: 'teacher123',
        role: 'teacher',
        name: 'Вчитель'
      },
      // приклад учня
      u1: {
        id: 'u1',
        username: 'sofia',
        password: '1234',
        role: 'student',
        name: 'Софія',
        coins: 100,
        grades: [],
        schedule: [],
        homework: []
      }
    },
    bots: [
      { id: 'b1', name: 'КіберКотик', coins: 40, grades: [] },
      { id: 'b2', name: 'Піфагорчик', coins: 55, grades: [] },
      { id: 'b3', name: 'МегаМозок', coins: 30, grades: [] },
      { id: 'b4', name: 'Промінчик', coins: 25, grades: [] }
    ],
    chat: [],
    quizResults: []
  };
}

function ensureData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData(), null, 2), 'utf-8');
  }
}

function loadData() {
  ensureData();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch (e) {
    console.error('Помилка читання data.json:', e);
    const d = defaultData();
    fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
    return d;
  }
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('Помилка запису data.json:', e);
  }
}

ensureData();

// ============== Middleware ==============
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: 'sunlorem-secret-key-2025',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 }
  })
);
app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(role) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    if (role && req.session.user.role !== role) return res.redirect('/dashboard');
    next();
  };
}

// ============== Сторінки (маршрути) ==============
app.get('/', (req, res) => {
  if (req.session.user) {
    return res.redirect(req.session.user.role === 'teacher' ? '/teacher' : '/dashboard');
  }
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/teacher', requireAuth('teacher'), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'teacher.html'));
});

app.get('/dashboard', requireAuth('student'), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/quiz', requireAuth(), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'quiz.html'));
});

app.get('/diary', requireAuth(), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'diary.html'));
});

app.get('/schedule', requireAuth(), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'schedule.html'));
});

app.get('/chat', requireAuth(), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// ============== API ==============

// --- Авторизація ---
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const data = loadData();
  const user = Object.values(data.users).find(
    (u) => u.username === username && u.password === password
  );
  if (!user) return res.json({ ok: false, message: 'Невірний логін або пароль' });
  req.session.user = {
    id: user.id,
    username: user.username,
    role: user.role,
    name: user.name
  };
  res.json({ ok: true, role: user.role });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.json({ ok: false });
  res.json({ ok: true, user: req.session.user });
});

// --- Список класу ---
app.get('/api/class', requireAuth(), (req, res) => {
  const data = loadData();
  const students = Object.values(data.users)
    .filter((u) => u.role === 'student')
    .map((s) => ({ id: s.id, name: s.name, coins: s.coins || 0, isBot: false }));
  const bots = data.bots.map((b) => ({
    id: b.id,
    name: b.name,
    coins: b.coins || 0,
    isBot: true
  }));
  res.json({ ok: true, students, bots });
});

// --- МАСОВЕ додавання ботів ---
app.post('/api/bots/bulk', requireAuth('teacher'), (req, res) => {
  const { names } = req.body;
  if (!names || typeof names !== 'string') {
    return res.json({ ok: false, message: 'Поле порожнє' });
  }
  const list = names
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);

  const data = loadData();
  const added = [];
  for (const name of list) {
    // уникаємо дублювання
    if (data.bots.some((b) => b.name.toLowerCase() === name.toLowerCase())) continue;
    const id = 'bot_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    data.bots.push({ id, name, coins: 0, grades: [] });
    added.push(name);
  }
  saveData(data);
  res.json({ ok: true, added, totalBots: data.bots.length });
});

// --- Видалення бота ---
app.delete('/api/bots/:id', requireAuth('teacher'), (req, res) => {
  const data = loadData();
  data.bots = data.bots.filter((b) => b.id !== req.params.id);
  saveData(data);
  res.json({ ok: true });
});

// --- Вікторина: список питань ---
const QUIZ_QUESTIONS = [
  { q: 'Скільки буде 7 × 8?', a: ['54', '56', '64', '48'], correct: 1 },
  { q: 'Яка планета найбільша в Сонячній системі?', a: ['Марс', 'Земля', 'Юпітер', 'Венера'], correct: 2 },
  { q: 'Хто написав "Кобзар"?', a: ['Леся Українка', 'Тарас Шевченко', 'Іван Франко', 'Григорій Сковорода'], correct: 1 },
  { q: 'Скільки сторін має шестикутник?', a: ['5', '6', '7', '8'], correct: 1 },
  { q: 'Яка столиця України?', a: ['Харків', 'Одеса', 'Київ', 'Львів'], correct: 2 }
];

app.get('/api/quiz/questions', requireAuth(), (req, res) => {
  res.json({ ok: true, questions: QUIZ_QUESTIONS });
});

// --- Вікторина: реєстрація учасників (гібридні боти) ---
const FUNNY_BOT_NAMES = [
  'КіберКотик', 'Піфагорчик', 'МегаМозок', 'Промінчик', 'Розумник',
  'БайтБобрик', 'ПрофесорКактус', 'ШвидкийЇжак', 'МістерАлгоритм',
  'СуперСофійка', 'Робот-Песик', 'КапітанФормула', 'ЛегкаБлискавка',
  'ЗагадковийЛис', 'РакетаЗнань', 'МозкоКрут', 'АлгебраКіт'
];

app.post('/api/quiz/start', requireAuth(), (req, res) => {
  const { customBots, totalPlayers } = req.body;
  const data = loadData();
  const participants = [];

  // 1) Вчитель або учень може вказати власні імена ботів
  const custom = Array.isArray(customBots)
    ? customBots.map((n) => String(n).trim()).filter(Boolean)
    : [];

  const total = Math.max(custom.length, Number(totalPlayers) || 6);

  for (const name of custom) participants.push({ name, isBot: true, score: 0 });

  // 2) Дозаповнюємо випадковими кумедними іменами
  const pool = [...FUNNY_BOT_NAMES];
  while (participants.length < total && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length);
    const name = pool.splice(idx, 1)[0];
    if (!participants.some((p) => p.name === name)) {
      participants.push({ name, isBot: true, score: 0 });
    }
  }

  // 3) Додаємо реального учня
  const me = data.users[req.session.user.id];
  if (me) {
    participants.unshift({ name: me.name || me.username, isBot: false, score: 0 });
  }

  res.json({ ok: true, participants });
});

// --- Вікторина: фініш, нарахування монет ---
app.post('/api/quiz/finish', requireAuth(), (req, res) => {
  const { results } = req.body; // [{ name, isBot, score }]
  if (!Array.isArray(results)) return res.json({ ok: false });

  const sorted = [...results].sort((a, b) => b.score - a.score);
  const data = loadData();

  const rewards = [];
  sorted.forEach((p, idx) => {
    let coins = 0;
    if (idx === 0) coins = 70;
    else if (idx === 1) coins = 60;
    else if (idx === 2) coins = 50;
    else coins = Math.min(30, Math.max(5, 30 - idx * 2));

    // нарахування монет реальному учню
    if (!p.isBot) {
      const me = data.users[req.session.user.id];
      if (me) me.coins = (me.coins || 0) + coins;
    } else {
      // боту — додаємо до масиву
      const bot = data.bots.find((b) => b.name === p.name);
      if (bot) bot.coins = (bot.coins || 0) + coins;
    }
    rewards.push({ ...p, place: idx + 1, coins });
  });

  data.quizResults.push({
    date: new Date().toISOString(),
    results: rewards
  });
  if (data.quizResults.length > 50) data.quizResults.shift();
  saveData(data);

  res.json({ ok: true, rewards });
});

// --- Щоденник і оцінки ---
app.get('/api/diary', requireAuth(), (req, res) => {
  const data = loadData();
  const me = data.users[req.session.user.id];
  if (!me) return res.json({ ok: true, grades: [] });
  res.json({ ok: true, grades: me.grades || [] });
});

app.post('/api/diary/grade', requireAuth('teacher'), (req, res) => {
  const { studentId, subject, grade, comment } = req.body;
  const data = loadData();
  const student = data.users[studentId];
  if (!student) return res.json({ ok: false, message: 'Учня не знайдено' });
  if (!Array.isArray(student.grades)) student.grades = [];
  student.grades.push({
    date: new Date().toISOString(),
    subject: subject || 'Предмет',
    grade: Number(grade) || 0,
    comment: comment || ''
  });
  saveData(data);
  res.json({ ok: true });
});

// --- Розклад і ДЗ ---
app.get('/api/schedule', requireAuth(), (req, res) => {
  const data = loadData();
  res.json({
    ok: true,
    schedule: data.schedule || [],
    homework: data.homework || []
  });
});

app.post('/api/schedule', requireAuth('teacher'), (req, res) => {
  const { day, subject, time, homework } = req.body;
  const data = loadData();
  if (!Array.isArray(data.schedule)) data.schedule = [];
  data.schedule.push({ day, subject, time });
  if (homework) {
    if (!Array.isArray(data.homework)) data.homework = [];
    data.homework.push({ day, subject, text: homework });
  }
  saveData(data);
  res.json({ ok: true });
});

// --- Чат: історія ---
app.get('/api/chat/history', requireAuth(), (req, res) => {
  const data = loadData();
  res.json({ ok: true, messages: (data.chat || []).slice(-100) });
});

// --- Чат: відправити повідомлення (реальний користувач) ---
app.post('/api/chat/send', requireAuth(), async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.json({ ok: false });

  const data = loadData();
  if (!Array.isArray(data.chat)) data.chat = [];

  const msg = {
    id: 'm' + Date.now(),
    author: req.session.user.name || req.session.user.username,
    role: req.session.user.role,
    text: String(text).slice(0, 500),
    time: Date.now()
  };
  data.chat.push(msg);
  if (data.chat.length > 300) data.chat.shift();
  saveData(data);
  io.emit('chat:new', msg);

  // Відповідь ботів
  triggerBotReplies(msg);

  res.json({ ok: true });
});

// ============== AI-боти в чаті ==============
const SAFE_FALLBACKS = [
  'Привіт! Класна тема 😄',
  'Я теж так думаю! 👍',
  'Оце так цікаво! 🤔',
  'Погоджуюсь, друзі! ✨',
  'А давайте ще щось обговоримо? 😊',
  'Супер! Я за! 🚀',
  'Хм, цікава думка 💡',
  'Ти круто пояснюєш! 👏'
];

const FORBIDDEN = ['фігня', 'дурня', 'дурень', 'лайка', 'fuck', 'shit', 'блін'];

function sanitizeBotText(text) {
  if (!text || typeof text !== 'string') return '';
  let t = text.trim().slice(0, 280);
  for (const w of FORBIDDEN) {
    const re = new RegExp(w, 'gi');
    t = t.replace(re, '😊');
  }
  // Прибираємо будь-які грубі вирази мінімально
  return t;
}

async function askGemini(promptText, botName) {
  if (!GEMINI_API_KEY) return null;
  try {
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=' +
      GEMINI_API_KEY;
    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text:
                `Ти — ввічливий учень 5-7 класу на ім'я ${botName}. ` +
                `Відповідай українською, коротко (1 речення), з 1-2 емодзі, без лайки ` +
                `та без слів типу "фігня". Тема розмови: "${promptText}".`
            }
          ]
        }
      ]
    };
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeout: 8000
    });
    if (!r.ok) return null;
    const json = await r.json();
    const t =
      json?.candidates?.[0]?.content?.parts?.[0]?.text ||
      json?.candidates?.[0]?.content?.parts?.[0]?.text === '' ? '' : '';
    return t ? sanitizeBotText(t) : null;
  } catch (e) {
    console.warn('Gemini API error:', e.message);
    return null;
  }
}

async function triggerBotReplies(sourceMsg) {
  const data = loadData();
  const bots = data.bots || [];
  if (bots.length === 0) return;

  // 1–2 боти відповідають
  const count = Math.min(bots.length, 1 + Math.floor(Math.random() * 2));
  const shuffled = [...bots].sort(() => Math.random() - 0.5).slice(0, count);

  for (let i = 0; i < shuffled.length; i++) {
    const bot = shuffled[i];
    setTimeout(async () => {
      let replyText = null;

      if (GEMINI_API_KEY) {
        replyText = await askGemini(sourceMsg.text, bot.name);
      }

      if (!replyText) {
        replyText = SAFE_FALLBACKS[Math.floor(Math.random() * SAFE_FALLBACKS.length)];
      }

      const botMsg = {
        id: 'bm' + Date.now() + Math.random().toString(36).slice(2, 5),
        author: bot.name,
        role: 'bot',
        text: replyText,
        time: Date.now()
      };

      const fresh = loadData();
      if (!Array.isArray(fresh.chat)) fresh.chat = [];
      fresh.chat.push(botMsg);
      if (fresh.chat.length > 300) fresh.chat.shift();
      saveData(fresh);

      io.emit('chat:new', botMsg);
    }, 800 + i * 900 + Math.random() * 700);
  }
}

// --- Socket.io ---
io.on('connection', (socket) => {
  socket.on('chat:typing', (data) => {
    socket.broadcast.emit('chat:typing', data);
  });
});

// ============== Запуск ==============
server.listen(PORT, () => {
  console.log(`🌞 SunLorem запущено: http://localhost:${PORT}`);
});
