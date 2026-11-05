/*
 * OpenMarket Auth SDK v2 (упрощённая схема)
 *
 * Быстрый старт:
 *   <script src="https://codexylabs.github.io/OpenMarket/openmarket-auth.js"></script>
 *   <script>
 *     OpenMarketAuth.mount('#om-auth', { onSignIn: function (user) { ... } });
 *   </script>
 *
 * Виджет сам рисует кнопку «Войти через OpenMarket», окно входа и состояние
 * «вы вошли». Никакого CSS подключать не нужно.
 *
 * Если нужен только программный доступ:
 *   OpenMarketAuth.signIn(email, password).then(...)
 *   OpenMarketAuth.currentUser(); OpenMarketAuth.signOut();
 *
 * Проверка идёт по публичному users.txt: email|salt|sha256(salt:password)|... .
 * Файл публичный, поэтому хеши паролей видны всем — не используйте здесь
 * пароль от других сервисов.
 */
(function (global) {
  'use strict';

  var DEFAULTS = {
    usersUrl: 'https://raw.githubusercontent.com/CodeXyLabs/OpenMarket/main/users.txt',
    cacheTtlMs: 5 * 60 * 1000,
    storageKey: 'openmarket.session.user',
    buttonText: 'Войти через OpenMarket'
  };

  var config = Object.assign({}, DEFAULTS);
  var cache = { raw: null, fetchedAt: 0 };
  var listeners = { change: [] };

  var MESSAGES = {
    user_not_found: 'Аккаунт с такой почтой не найден в OpenMarket.',
    wrong_password: 'Неверный пароль.',
    registry_unavailable: 'Не удалось проверить аккаунт: нет связи с реестром.',
    fill_fields: 'Заполните почту и пароль.',
    insecure_context: 'Нужен HTTPS: браузер блокирует криптографию на http.'
  };

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function toHex(buffer) {
    var bytes = new Uint8Array(buffer);
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      out += bytes[i] < 16 ? '0' + bytes[i].toString(16) : bytes[i].toString(16);
    }
    return out;
  }

  function sha256(text) {
    if (!global.crypto || !global.crypto.subtle) {
      return Promise.reject(makeError('insecure_context'));
    }
    return global.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(toHex);
  }

  function makeError(code) {
    var error = new Error(MESSAGES[code] || code);
    error.code = code;
    return error;
  }

  function parseUsers(raw) {
    var users = [];
    raw.split('\n').forEach(function (line) {
      var trimmed = line.trim();
      if (!trimmed || trimmed.charAt(0) === '#') return;
      var parts = trimmed.split('|');
      if (parts.length < 5) return;
      var email = normalizeEmail(parts[0]);
      var salt = parts[1].trim();
      var hash = parts[2].trim();
      if (!email || !salt || !hash) return;
      users.push({
        email: email,
        salt: salt,
        hash: hash.toLowerCase(),
        createdAt: Number(parts[3].trim()) || 0,
        role: parts[4].trim() || 'user'
      });
    });
    return users;
  }

  function loadRegistry(force) {
    var fresh = cache.raw && (Date.now() - cache.fetchedAt < config.cacheTtlMs);
    if (fresh && !force) return Promise.resolve(cache.raw);

    var url = config.usersUrl + (config.usersUrl.indexOf('?') === -1 ? '?' : '&') + 't=' + Date.now();
    return fetch(url, { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw makeError('registry_unavailable');
        return response.text();
      })
      .then(function (text) {
        cache.raw = text;
        cache.fetchedAt = Date.now();
        return text;
      })
      .catch(function (error) {
        throw error.code ? error : makeError('registry_unavailable');
      });
  }

  function emit() {
    var user = currentUser();
    listeners.change.forEach(function (handler) {
      try { handler(user); } catch (ignored) {}
    });
  }

  function signIn(email, password) {
    var normalized = normalizeEmail(email);
    if (!normalized || !password) return Promise.reject(makeError('fill_fields'));

    return loadRegistry(false).then(function (raw) {
      var user = parseUsers(raw).filter(function (item) {
        return item.email === normalized;
      })[0];

      if (!user) throw makeError('user_not_found');

      return sha256(user.salt + ':' + password).then(function (hash) {
        if (hash !== user.hash) throw makeError('wrong_password');

        var session = {
          email: user.email,
          role: user.role,
          createdAt: user.createdAt,
          signedInAt: Date.now()
        };
        try {
          global.localStorage.setItem(config.storageKey, JSON.stringify(session));
        } catch (ignored) {}
        emit();
        return session;
      });
    });
  }

  function signOut() {
    try {
      global.localStorage.removeItem(config.storageKey);
    } catch (ignored) {}
    emit();
  }

  function currentUser() {
    try {
      var raw = global.localStorage.getItem(config.storageKey);
      return raw ? JSON.parse(raw) : null;
    } catch (ignored) {
      return null;
    }
  }

  function configure(options) {
    Object.assign(config, options || {});
    cache = { raw: null, fetchedAt: 0 };
  }

  function on(event, handler) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(handler);
    return function () { off(event, handler); };
  }

  function off(event, handler) {
    if (!listeners[event]) return;
    listeners[event] = listeners[event].filter(function (item) { return item !== handler; });
  }

  /* ---------- виджет ---------- */

  var CSS = '' +
    '.oma-wrap{font-family:inherit;display:inline-flex;align-items:center;gap:10px;flex-wrap:wrap}' +
    '.oma-btn{display:inline-flex;align-items:center;gap:8px;border:0;border-radius:14px;padding:11px 18px;' +
    'font:inherit;font-weight:600;font-size:14px;cursor:pointer;background:#4B2BE6;color:#fff}' +
    '.oma-btn:hover{background:#3f22c4}' +
    '.oma-btn:disabled{opacity:.6;cursor:default}' +
    '.oma-user{font-size:14px;color:#3c3850}' +
    '.oma-user b{word-break:break-all}' +
    '.oma-link{background:none;border:0;padding:0;font:inherit;font-size:13px;color:#4B2BE6;cursor:pointer;text-decoration:underline}' +
    '.oma-overlay{position:fixed;inset:0;background:rgba(24,18,48,.45);display:flex;align-items:center;' +
    'justify-content:center;padding:20px;z-index:2147483000}' +
    '.oma-modal{background:#fff;border-radius:22px;padding:24px;width:100%;max-width:380px;' +
    'box-shadow:0 24px 60px rgba(20,14,50,.28);font-family:inherit;color:#1d1a2b}' +
    '.oma-modal h3{margin:0 0 6px;font-size:19px}' +
    '.oma-modal p.oma-sub{margin:0 0 16px;font-size:13px;color:#6b6780;line-height:1.5}' +
    '.oma-modal label{display:block;font-size:13px;color:#6b6780;margin-bottom:12px}' +
    '.oma-modal input{display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:11px 13px;' +
    'border-radius:12px;border:1px solid rgba(30,20,70,.2);font:inherit;font-size:15px;color:#1d1a2b;background:#fff}' +
    '.oma-modal input:focus{outline:2px solid #4B2BE6;outline-offset:0}' +
    '.oma-actions{display:flex;gap:8px;margin-top:6px}' +
    '.oma-actions .oma-btn{flex:1;justify-content:center}' +
    '.oma-cancel{background:#f0eefb;color:#3c3850}' +
    '.oma-cancel:hover{background:#e6e2f7}' +
    '.oma-error{margin-top:12px;font-size:13px;line-height:1.45;color:#8c1d1d;background:#fdecec;' +
    'border-radius:10px;padding:9px 11px;display:none}' +
    '.oma-error.show{display:block}';

  function injectCss() {
    if (document.getElementById('openmarket-auth-css')) return;
    var style = document.createElement('style');
    style.id = 'openmarket-auth-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function build(session, options) {
    var wrap = document.createElement('div');
    wrap.className = 'oma-wrap';

    if (session) {
      var info = document.createElement('span');
      info.className = 'oma-user';
      info.innerHTML = 'Вы вошли как <b>' + session.email + '</b>';

      var out = document.createElement('button');
      out.type = 'button';
      out.className = 'oma-link';
      out.textContent = 'Выйти';
      out.addEventListener('click', function () {
        signOut();
        if (typeof options.onSignOut === 'function') options.onSignOut();
      });

      wrap.appendChild(info);
      wrap.appendChild(out);
      return wrap;
    }

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'oma-btn';
    button.textContent = options.buttonText || config.buttonText;
    button.addEventListener('click', function () { openModal(options); });
    wrap.appendChild(button);
    return wrap;
  }

  function openModal(options) {
    injectCss();

    var overlay = document.createElement('div');
    overlay.className = 'oma-overlay';
    overlay.innerHTML =
      '<div class="oma-modal" role="dialog" aria-modal="true" aria-label="Вход через OpenMarket">' +
      '  <h3>Вход через OpenMarket</h3>' +
      '  <p class="oma-sub">Используется аккаунт магазина OpenMarket. Пароль не покидает браузер: ' +
      'страница сверяет только хеш.</p>' +
      '  <label>Почта<input class="oma-email" type="email" autocomplete="username" ' +
      'placeholder="you@example.com"></label>' +
      '  <label>Пароль<input class="oma-password" type="password" autocomplete="current-password" ' +
      'placeholder="Пароль от OpenMarket"></label>' +
      '  <div class="oma-actions">' +
      '    <button type="button" class="oma-btn oma-submit">Войти</button>' +
      '    <button type="button" class="oma-btn oma-cancel">Отмена</button>' +
      '  </div>' +
      '  <div class="oma-error"></div>' +
      '</div>';

    document.body.appendChild(overlay);

    var emailInput = overlay.querySelector('.oma-email');
    var passwordInput = overlay.querySelector('.oma-password');
    var submit = overlay.querySelector('.oma-submit');
    var cancel = overlay.querySelector('.oma-cancel');
    var errorBox = overlay.querySelector('.oma-error');

    function close() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    function fail(message) {
      errorBox.textContent = message;
      errorBox.className = 'oma-error show';
      submit.disabled = false;
      submit.textContent = 'Войти';
    }

    function submitForm() {
      errorBox.className = 'oma-error';
      submit.disabled = true;
      submit.textContent = 'Проверяем…';

      signIn(emailInput.value, passwordInput.value)
        .then(function (session) {
          close();
          if (typeof options.onSignIn === 'function') options.onSignIn(session);
        })
        .catch(function (error) {
          fail(MESSAGES[error.code] || error.message || 'Не удалось войти');
        });
    }

    submit.addEventListener('click', submitForm);
    cancel.addEventListener('click', close);
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) close();
    });
    overlay.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') close();
      if (event.key === 'Enter') submitForm();
    });

    emailInput.focus();
  }

  function mount(target, options) {
    injectCss();
    options = options || {};

    var host = typeof target === 'string' ? document.querySelector(target) : target;
    if (!host) throw new Error('OpenMarketAuth.mount: контейнер не найден');

    function render() {
      host.innerHTML = '';
      host.appendChild(build(currentUser(), options));
    }

    render();
    on('change', function () { render(); });
    return { refresh: render };
  }

  global.OpenMarketAuth = {
    configure: configure,
    signIn: signIn,
    signOut: signOut,
    currentUser: currentUser,
    loadRegistry: loadRegistry,
    mount: mount,
    on: on,
    off: off,
    messages: MESSAGES,
    _sha256: sha256
  };
})(window);
