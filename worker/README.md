# Прокси Cloudflare Worker для OpenMarket

Воркер принимает запросы сайта и добавляет GitHub-токен на сервере. Токен не попадает в браузер и в репозиторий.

## Деплой без терминала (5 минут)

1. Откройте https://dash.cloudflare.com и войдите в аккаунт.
2. Слева: **Workers & Pages** → **Create** → **Worker** → **Deploy** (создастся пустой воркер).
3. Нажмите **Edit code**, удалите содержимое и вставьте код из `worker/worker.js`.
4. Откройте **Settings** → **Variables and Secrets** → **Add**:
   - Name: `GITHUB_TOKEN`
   - Value: ваш GitHub-токен (лучше fine-grained: только этот репозиторий, права Contents: Read and write)
   - Нажмите **Encrypt** / **Secret**, затем **Save and deploy**.
5. Скопируйте адрес воркера вида `https://openmarket-proxy.<ваш-поддомен>.workers.dev`.
6. Вставьте его в `docs/config.js`:

```js
window.OPENMARKET_CONFIG = {
  workerUrl: 'https://openmarket-proxy.<ваш-поддомен>.workers.dev'
};
```

После этого сайт ходит через воркер: токен в браузере и в репозитории не нужен.

## Что проксируется

- `/repos/CodeXyLabs/OpenMarket/...` → `https://api.github.com/repos/CodeXyLabs/OpenMarket/...`
- `/uploads/repos/CodeXyLabs/OpenMarket/...` → `https://uploads.github.com/repos/CodeXyLabs/OpenMarket/...`
- `/user` → `https://api.github.com/user`

Остальные пути запрещены (403), чтобы воркер нельзя было использовать как открытый прокси.

## Проверка

```bash
curl -i "https://openmarket-proxy.<поддомен>.workers.dev/repos/CodeXyLabs/OpenMarket/contents/apps.json"
```

Должен вернуться JSON с `content` (HTTP 200). Если 401 — не задан или не сохранён `GITHUB_TOKEN`.
