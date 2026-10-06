// Загальні функції для всіх сторінок
async function api(url, options = {}) {
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      ...options
    });
    return await res.json();
  } catch (e) {
    console.error('API error:', e);
    return { ok: false, message: 'Помилка мережі' };
  }
}

async function loadMe() {
  const r = await api('/api/me');
  if (!r.ok) {
    window.location.href = '/login';
    return null;
  }
  return r.user;
}

async function logout() {
  await api('/api/logout', { method: 'POST' });
  window.location.href = '/login';
}

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}

function buildNav(user, active) {
  const links = [];
  if (user.role === 'teacher') {
    links.push({ href: '/teacher', label: '👩‍🏫 Панель вчителя' });
    links.push({ href: '/quiz', label: '🧠 Вікторина' });
    links.push({ href: '/diary', label: '📔 Щоденник' });
    links.push({ href: '/schedule', label: '📅 Розклад' });
    links.push({ href: '/chat', label: '💬 Чат' });
  } else {
    links.push({ href: '/dashboard', label: '🏠 Кабінет' });
    links.push({ href: '/quiz', label: '🧠 Вікторина' });
    links.push({ href: '/diary', label: '📔 Щоденник' });
    links.push({ href: '/schedule', label: '📅 Розклад' });
    links.push({ href: '/chat', label: '💬 Чат' });
  }
  const html = links
    .map(
      (l) =>
        `<a href="${l.href}" class="${l.href === active ? 'active' : ''}">${l.label}</a>`
    )
    .join('');
  return `
    <div class="topbar">
      <h1>🌞 SunLorem — 5 клас</h1>
      <div class="nav-links">
        ${html}
        <a href="#" onclick="logout();return false;" style="background:rgba(220,38,38,0.5);">🚪 Вийти</a>
      </div>
    </div>
  `;
}

async function renderTopbar(active) {
  const user = await loadMe();
  if (!user) return null;
  const nav = document.getElementById('topbar');
  if (nav) nav.innerHTML = buildNav(user, active);
  return user;
}
