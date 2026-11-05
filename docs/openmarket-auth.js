/*
 * OpenMarket Auth SDK (упрощённая схема)
 *
 * Вход в сторонние сайты и веб-приложения по аккаунту OpenMarket.
 * Проверка выполняется по публичному реестру users.txt:
 *   email|salt|sha256(salt:password)|createdAtMillis|role
 *
 * ВНИМАНИЕ: файл users.txt публичный, поэтому хеши паролей видны всем.
 * Схема подходит для демонстрации и внутренних проектов, но не заменяет
 * полноценный OAuth. Пользователям не следует использовать здесь пароль,
 * который они применяют в других сервисах.
 */
(function (global) {
  'use strict';

  var DEFAULTS = {
    usersUrl: 'https://raw.githubusercontent.com/CodeXyLabs/OpenMarket/main/users.txt',
    cacheTtlMs: 5 * 60 * 1000,
    storageKey: 'openmarket.session.user'
  };

  var config = Object.assign({}, DEFAULTS);
  var cache = { raw: null, fetchedAt: 0 };

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
      return Promise.reject(makeError('insecure_context',
        'WebCrypto недоступен: нужен HTTPS и современный браузер'));
    }
    var data = new TextEncoder().encode(text);
    return global.crypto.subtle.digest('SHA-256', data).then(toHex);
  }

  function makeError(code, message) {
    var error = new Error(message || code);
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
        if (!response.ok) throw makeError('registry_unavailable', 'Не удалось загрузить users.txt');
        return response.text();
      })
      .then(function (text) {
        cache.raw = text;
        cache.fetchedAt = Date.now();
        return text;
      })
      .catch(function (error) {
        if (error.code) throw error;
        throw makeError('registry_unavailable', 'Нет связи с реестром OpenMarket');
      });
  }

  function signIn(email, password) {
    var normalized = normalizeEmail(email);
    if (!normalized || !password) {
      return Promise.reject(makeError('fill_fields', 'Укажите почту и пароль'));
    }

    return loadRegistry(false).then(function (raw) {
      var user = parseUsers(raw).filter(function (item) {
        return item.email === normalized;
      })[0];

      if (!user) throw makeError('user_not_found', 'Аккаунт не найден в OpenMarket');

      return sha256(user.salt + ':' + password).then(function (hash) {
        if (hash !== user.hash) throw makeError('wrong_password', 'Неверный пароль');

        var session = {
          email: user.email,
          role: user.role,
          createdAt: user.createdAt,
          signedInAt: Date.now()
        };
        try {
          global.localStorage.setItem(config.storageKey, JSON.stringify(session));
        } catch (ignored) {}
        return session;
      });
    });
  }

  function currentUser() {
    try {
      var raw = global.localStorage.getItem(config.storageKey);
      return raw ? JSON.parse(raw) : null;
    } catch (ignored) {
      return null;
    }
  }

  function signOut() {
    try {
      global.localStorage.removeItem(config.storageKey);
    } catch (ignored) {}
  }

  function configure(options) {
    Object.assign(config, options || {});
    cache = { raw: null, fetchedAt: 0 };
  }

  global.OpenMarketAuth = {
    configure: configure,
    signIn: signIn,
    signOut: signOut,
    currentUser: currentUser,
    loadRegistry: loadRegistry,
    _sha256: sha256
  };
})(window);
