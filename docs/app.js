const CONFIG = {
  owner: 'CodeXyLabs',
  repo: 'OpenMarket',
  branch: 'main',
  apiBase: 'https://api.github.com',
  rawBase: 'https://raw.githubusercontent.com',
  uploadsBase: 'https://uploads.github.com',
};

const FILES = { users: 'users.txt', apps: 'apps.json' };

function workerUrl() {
  const fromConfig = (window.OPENMARKET_CONFIG && window.OPENMARKET_CONFIG.workerUrl) || '';
  const fromStorage = localStorage.getItem('om_worker') || '';
  return (fromStorage || fromConfig).replace(/\/+$/, '');
}

function apiBase() {
  const worker = workerUrl();
  return worker || CONFIG.apiBase;
}

function uploadsBase() {
  const worker = workerUrl();
  return worker ? `${worker}/uploads` : CONFIG.uploadsBase;
}

const state = {
  apps: [],
  category: 'all',
  query: '',
  sort: 'new',
  session: JSON.parse(localStorage.getItem('om_user') || 'null'),
  authMode: 'login',
  busy: false,
};

const $ = (id) => document.getElementById(id);

function toast(message, ms = 2600) {
  const el = $('toast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), ms);
}

function token() {
  return localStorage.getItem('om_token') || CONFIG.token || '';
}

function requireToken() {
  if (!token()) {
    toast('Нужен GitHub-токен: откройте настройки');
    openModal('settingsModal');
    return false;
  }
  return true;
}

function b64encodeUtf8(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function b64decodeUtf8(base64) {
  const binary = atob(base64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function hex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  return hex(await crypto.subtle.digest('SHA-256', data));
}

async function sha256FileHex(file) {
  const buffer = await file.arrayBuffer();
  return hex(await crypto.subtle.digest('SHA-256', buffer));
}

function randomSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function headers(extra = {}) {
  const h = { Accept: 'application/vnd.github+json', ...extra };
  if (token()) h.Authorization = `Bearer ${token()}`;
  return h;
}

async function readTextFile(name) {
  const url = `${CONFIG.rawBase}/${CONFIG.owner}/${CONFIG.repo}/${CONFIG.branch}/${name}?t=${Date.now()}`;
  const res = await fetch(url, { headers: token() ? { Authorization: `Bearer ${token()}` } : {} });
  if (res.status === 404) return '';
  if (!res.ok) throw new Error(`Не удалось прочитать ${name} (${res.status})`);
  return res.text();
}

async function fileSha(name) {
  const url = `${apiBase()}/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${name}?ref=${CONFIG.branch}`;
  const res = await fetch(url, { headers: headers() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Не удалось получить ${name} (${res.status})`);
  const json = await res.json();
  return json.sha || null;
}

async function writeTextFile(name, text, message) {
  const url = `${apiBase()}/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${name}`;
  const content = b64encodeUtf8(text);
  let lastError = 'Не удалось записать файл';

  for (let attempt = 0; attempt < 2; attempt++) {
    let sha = null;
    try {
      sha = await fileSha(name);
    } catch (e) {
      sha = null;
    }

    const payload = { message, content, branch: CONFIG.branch };
    if (sha) payload.sha = sha;

    const res = await fetch(url, {
      method: 'PUT',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    if (res.ok) return;

    lastError = `Не удалось записать ${name} (${res.status})`;
    try {
      const body = await res.text();
      if (body) lastError += `: ${body}`;
    } catch (e) { /* ignore */ }
  }

  throw new Error(lastError);
}

function parseUsers(raw) {
  return raw.split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const p = line.split('|');
      return { email: p[0], salt: p[1], hash: p[2], createdAt: p[3], role: p[4] || 'user' };
    })
    .filter((u) => u.email && u.salt && u.hash);
}

function usersHeader() {
  return '# OpenMarket: реестр пользователей\n# Формат: email|salt|sha256(salt:password)|createdAtMillis|role\n';
}

async function register(email, password) {
  if (!requireToken()) return;
  const normalized = email.trim().toLowerCase();
  const raw = await readTextFile(FILES.users);
  const users = parseUsers(raw);
  if (users.some((u) => u.email === normalized)) throw new Error('Такой аккаунт уже существует');

  const salt = randomSalt();
  const hash = await sha256Hex(`${salt}:${password}`);
  const line = `${normalized}|${salt}|${hash}|${Date.now()}|user\n`;
  const content = raw.trim() ? raw.replace(/\n?$/, '\n') + line : usersHeader() + line;
  await writeTextFile(FILES.users, content, `OpenMarket web: регистрация ${normalized}`);
}

async function login(email, password) {
  const normalized = email.trim().toLowerCase();
  const users = parseUsers(await readTextFile(FILES.users));
  const user = users.find((u) => u.email === normalized);
  if (!user) throw new Error('Аккаунт не найден');
  const hash = await sha256Hex(`${user.salt}:${password}`);
  if (hash.toLowerCase() !== user.hash.toLowerCase()) throw new Error('Неверный пароль');
  return { email: user.email, role: user.role || 'user' };
}

function setSession(session) {
  state.session = session;
  if (session) localStorage.setItem('om_user', JSON.stringify(session));
  else localStorage.removeItem('om_user');
  renderAuthButton();
}

function renderAuthButton() {
  const btn = $('btnAuth');
  if (state.session) {
    btn.textContent = state.session.email.split('@')[0];
    btn.title = 'Выйти';
  } else {
    btn.textContent = 'Войти';
    btn.title = '';
  }
}

async function loadCatalog() {
  try {
    const raw = await readTextFile(FILES.apps);
    state.apps = raw.trim() ? JSON.parse(raw) : [];
  } catch (e) {
    state.apps = [];
    toast(e.message);
  }
  renderCatalog();
}

function renderCatalog() {
  const grid = $('grid');
  const q = state.query.trim().toLowerCase();
  const cat = state.category;

  let apps = state.apps.filter((app) => {
    if (cat !== 'all') {
      const isGame = app.category === 'Игра';
      if (cat === 'game' && !isGame) return false;
      if (cat === 'app' && isGame) return false;
    }
    if (!q) return true;
    const haystack = [
      app.name, app.developer, app.description, app.category, app.subcategory,
      ...(app.tags || []),
    ].join(' ').toLowerCase();
    return haystack.includes(q);
  });

  apps = apps.slice().sort((a, b) => {
    if (state.sort === 'name') return (a.name || '').localeCompare(b.name || '', 'ru');
    if (state.sort === 'size') return (b.sizeBytes || 0) - (a.sizeBytes || 0);
    return (b.uploadedAt || 0) - (a.uploadedAt || 0);
  });

  $('statApps').textContent = String(state.apps.length);
  $('empty').classList.toggle('hidden', apps.length > 0);
  grid.innerHTML = '';

  apps.forEach((app) => {
    const card = document.createElement('article');
    card.className = 'card';
    const icon = app.iconUrl
      ? `<img class="app-icon" src="${app.iconUrl}" alt="">`
      : `<div class="app-icon">${(app.name || '?').trim().charAt(0).toUpperCase()}</div>`;
    const size = app.sizeBytes ? `${(app.sizeBytes / 1024 / 1024).toFixed(1)} МБ` : '';
    card.innerHTML = `
      ${icon}
      <div class="card-body">
        <div class="card-title">${escapeHtml(app.name || 'Без названия')}</div>
        <div class="card-sub">${escapeHtml(app.developer || '')}</div>
        <div class="card-meta">
          <span class="badge">${escapeHtml(app.category || 'Приложение')}</span>
          ${size ? `<span class="badge">${size}</span>` : ''}
          ${app.subcategory ? `<span class="badge">${escapeHtml(app.subcategory)}</span>` : ''}
        </div>
      </div>`;
    card.addEventListener('click', () => showDetails(app));
    grid.appendChild(card);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function showDetails(app) {
  const size = app.sizeBytes ? `${(app.sizeBytes / 1024 / 1024).toFixed(1)} МБ` : '';
  const tags = (app.tags || []).map((t) => `<span class="badge">${escapeHtml(t)}</span>`).join(' ');
  $('detailBody').innerHTML = `
    <div class="detail-head">
      ${app.iconUrl
        ? `<img class="app-icon" src="${app.iconUrl}" alt="">`
        : `<div class="app-icon">${(app.name || '?').trim().charAt(0).toUpperCase()}</div>`}
      <div>
        <div class="detail-title">${escapeHtml(app.name || '')}</div>
        <div class="muted">${escapeHtml(app.developer || '')}</div>
      </div>
    </div>
    <p>${escapeHtml(app.description || 'Без описания')}</p>
    <div class="card-meta">
      <span class="badge">${escapeHtml(app.category || '')}</span>
      ${size ? `<span class="badge">${size}</span>` : ''}
      ${tags}
    </div>
    <div class="detail-actions">
      ${app.downloadUrl ? `<a class="btn primary" href="${app.downloadUrl}" target="_blank" rel="noopener">Скачать APK</a>` : ''}
      ${app.sha256 ? `<span class="badge">SHA-256: ${escapeHtml(app.sha256.slice(0, 16))}…</span>` : ''}
    </div>`;
  openModal('detailModal');
}

function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }

function setAuthMode(mode) {
  state.authMode = mode;
  $('tabLogin').classList.toggle('active', mode === 'login');
  $('tabRegister').classList.toggle('active', mode === 'register');
  $('authTitle').textContent = mode === 'login' ? 'Вход' : 'Регистрация';
  $('authSubmit').textContent = mode === 'login' ? 'Войти' : 'Создать аккаунт';
  $('authHint').textContent = mode === 'register'
    ? 'Для регистрации нужен GitHub-токен в настройках.'
    : '';
}

async function createRelease(releaseName) {
  const res = await fetch(`${apiBase()}/repos/${CONFIG.owner}/${CONFIG.repo}/releases`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      tag_name: `web-${Date.now()}`,
      name: releaseName,
      body: 'Публикация через веб-каталог OpenMarket',
      draft: false,
      prerelease: false,
    }),
  });
  if (!res.ok) throw new Error(`Не удалось создать релиз (${res.status})`);
  return (await res.json()).id;
}

function uploadAsset(releaseId, file, assetName, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = `${uploadsBase()}/repos/${CONFIG.owner}/${CONFIG.repo}/releases/${releaseId}/assets?name=${encodeURIComponent(assetName)}`;
    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', `Bearer ${token()}`);
    xhr.setRequestHeader('Accept', 'application/vnd.github+json');
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
      else reject(new Error(`Загрузка ${assetName} не удалась (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Сеть недоступна'));
    xhr.send(file);
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
}

async function uploadFileContents(file, path) {
  const content = await fileToBase64(file);
  const url = `${apiBase()}/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${path}`;
  const payload = {
    message: `OpenMarket web: ${path}`,
    content,
    branch: CONFIG.branch,
  };

  const res = await fetch(url, {
    method: 'PUT',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch (e) { /* ignore */ }
    throw new Error(`Не удалось загрузить файл (${res.status})${body ? ': ' + body : ''}`);
  }

  return `${CONFIG.rawBase}/${CONFIG.owner}/${CONFIG.repo}/${CONFIG.branch}/${path}`;
}

async function publishApp() {
  const apk = $('appApk').files[0];
  if (!apk) throw new Error('Выберите APK-файл');
  if (apk.size > 90 * 1024 * 1024) {
    throw new Error('APK больше 90 МБ — опубликуйте его из приложения OpenMarket');
  }

  const name = $('appName').value.trim();
  const id = crypto.randomUUID ? crypto.randomUUID() : `web-${Date.now()}`;
  const safeName = apk.name.replace(/[^A-Za-z0-9._-]/g, '_') || 'app.apk';
  const apkPath = `apps/${id}/${safeName}`;

  $('publishProgress').classList.remove('hidden');
  $('publishBar').style.width = '15%';

  const downloadUrl = await uploadFileContents(apk, apkPath);
  $('publishBar').style.width = '70%';

  let iconUrl = null;
  const icon = $('appIcon').files[0];
  if (icon) {
    const iconPath = `apps/${id}/icon${extensionOf(icon.name) || '.png'}`;
    iconUrl = await uploadFileContents(icon, iconPath);
  }
  $('publishBar').style.width = '90%';

  const app = {
    id,
    name,
    developer: $('appDeveloper').value.trim(),
    description: $('appDescription').value.trim(),
    category: $('appCategory').value,
    subcategory: $('appSubcategory').value.trim(),
    fileName: safeName,
    downloadUrl,
    uploadedAt: Date.now(),
    uploadedBy: state.session ? state.session.email : null,
    iconUrl,
    screenshots: [],
    tags: $('appTags').value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
    sha256: await sha256FileHex(apk),
    sizeBytes: apk.size,
    scanLevel: 'unknown',
    scanFindings: [],
    permissions: [],
    versionCode: 0,
    packageName: null,
  };

  const raw = await readTextFile(FILES.apps);
  const apps = raw.trim() ? JSON.parse(raw) : [];
  apps.push(app);
  await writeTextFile(FILES.apps, JSON.stringify(apps), `OpenMarket web: публикация ${name}`);
  $('publishBar').style.width = '100%';
  toast('Приложение опубликовано');
}

function extensionOf(fileName) {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot) : '';
}

document.addEventListener('DOMContentLoaded', () => {
  renderAuthButton();
  loadCatalog();

  $('search').addEventListener('input', (e) => {
    state.query = e.target.value;
    renderCatalog();
  });

  $('sort').addEventListener('change', (e) => {
    state.sort = e.target.value;
    renderCatalog();
  });

  $('filters').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    document.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    state.category = chip.dataset.cat;
    renderCatalog();
  });

  $('btnAuth').addEventListener('click', () => {
    if (state.session) {
      setSession(null);
      toast('Вы вышли');
      return;
    }
    setAuthMode('login');
    openModal('authModal');
  });

  $('tabLogin').addEventListener('click', () => setAuthMode('login'));
  $('tabRegister').addEventListener('click', () => setAuthMode('register'));

  $('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.busy) return;
    const email = $('authEmail').value;
    const password = $('authPassword').value;
    state.busy = true;
    $('authSubmit').disabled = true;
    try {
      if (state.authMode === 'login') {
        setSession(await login(email, password));
        toast('Добро пожаловать');
      } else {
        await register(email, password);
        setSession({ email: email.trim().toLowerCase(), role: 'user' });
        toast('Аккаунт создан');
      }
      closeModal('authModal');
      $('authForm').reset();
    } catch (err) {
      toast(err.message, 4000);
    } finally {
      state.busy = false;
      $('authSubmit').disabled = false;
    }
  });

  $('btnPublish').addEventListener('click', () => {
    if (!state.session) {
      setAuthMode('login');
      openModal('authModal');
      toast('Сначала войдите');
      return;
    }
    if (!requireToken()) return;
    openModal('publishModal');
  });

  $('publishForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.busy) return;
    state.busy = true;
    $('publishSubmit').disabled = true;
    $('publishBar').style.width = '0%';
    try {
      await publishApp();
      closeModal('publishModal');
      $('publishForm').reset();
      $('publishProgress').classList.add('hidden');
      await loadCatalog();
    } catch (err) {
      toast(err.message, 5000);
    } finally {
      state.busy = false;
      $('publishSubmit').disabled = false;
    }
  });

  $('btnSettings').addEventListener('click', () => {
    $('settingsToken').value = token();
    $('settingsStatus').textContent = token() ? 'Токен сохранён' : 'Токен не задан — режим только для чтения';
    openModal('settingsModal');
  });

  $('settingsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const value = $('settingsToken').value.trim();
    if (value) localStorage.setItem('om_token', value);
    $('settingsStatus').textContent = value ? 'Токен сохранён' : 'Токен удалён';
    toast(value ? 'Токен сохранён' : 'Токен удалён');
  });

  $('settingsClear').addEventListener('click', () => {
    localStorage.removeItem('om_token');
    $('settingsToken').value = '';
    $('settingsStatus').textContent = 'Токен удалён';
    toast('Токен удалён');
  });

  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });

  document.querySelectorAll('.modal').forEach((modal) => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  });
});
