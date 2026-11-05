# OpenMarket

Открытый каталог Android-приложений и игр: приложение-клиент, сайт каталога, консоль разработчика и вход по аккаунту OpenMarket для сторонних проектов.

## Что внутри

| Часть | Где | Что делает |
|---|---|---|
| Android-приложение | `app/` | Каталог, установка APK с проверкой SHA-256, отзывы, кабинет разработчика, публикация и обновления, гайд, переключение языка |
| Сайт | `docs/` | Каталог, консоль разработчика, гайд, демонстрация входа, 404 |
| SDL входа | `docs/openmarket-auth.js` | `OpenMarketAuth.mount('#om-auth')` — кнопка и окно входа для сайтов |
| Android SDK входа | `docs/OpenMarketAuth.android.kt` | Один файл без зависимостей для сторонних приложений |
| Данные каталога | `apps.json`, `reviews.json`, `users.txt`, `downloads.json`, `apps.json.sig` | Хранятся в корне репозитория |
| Прокси (опционально) | `worker/` | Cloudflare Worker для обхода ограничений GitHub в РФ |

Сайт: https://codexylabs.github.io/OpenMarket/

## Сборка приложения

Требования: JDK 17+, Android SDK (compileSdk 37), Gradle 9.6 (wrapper в комплекте).

```powershell
.\gradlew.bat :app:assembleDebug      # отладочная
.\gradlew.bat :app:assembleRelease    # релизная, подпись + R8
```

Релизная сборка берёт ключ из `keystore.properties` (в репозиторий не коммитится):

```properties
storeFile=openmarket-release.jks
storePassword=...
keyAlias=openmarket
keyPassword=...
```

Если файла нет, release собирается debug-ключом — для публикации это неприемлемо.

R8 включён (`optimization { enable = true }`), правила — `app/proguard-rules.pro`. Отчёт и mapping: `app/build/outputs/mapping/release/`.

Проверка подписи:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\build-tools\<версия>\apksigner.bat" verify --print-certs <apk>
```

Ожидаемый отпечаток: `73ed162384142bfc8b5a7a77bebf820fa35e1b3a55b39d45ac02dbbf8821f82b`
(`CN=OpenMarket, OU=Mobile, O=CodeXyLabs, L=Krasnoyarsk, C=RU`).

## Публикация приложения в каталог

1. Соберите релизный APK тем же ключом, что и предыдущая версия, — иначе обновление блокируется сверкой `signerSha256`.
2. В приложении: «Добавить приложение» → карточка, иконка, скриншоты, теги.
3. Загрузка идёт в фоне (`PublishWorker`), прогресс в уведомлении; релиз создаётся в GitHub Releases.
4. Каталог обновляется в `apps.json`; для сайта публикация возможна из консоли, но APK до 90 МБ (предел Contents API).

## Сайт

Статические страницы в `docs/`, публикуются GitHub Pages из ветки `main`.

- `/` — каталог, подборки, поиск
- `/console.html` — консоль: обзор, приложения, версии, отзывы, статистика
- `/guide.html` — гайд разработчика
- `/auth-demo.html` — вход через OpenMarket и примеры встраивания
- `/404.html` — страница ошибки

Дизайн — Material 3: токены, тёмная тема, компоненты в `docs/styles.css`.

## Вход через OpenMarket

Упрощённая схема без сервера: страница сверяет `SHA-256(salt:пароль)` с публичным `users.txt`.

```html
<div id="om-auth"></div>
<script src="https://codexylabs.github.io/OpenMarket/openmarket-auth.js"></script>
<script>OpenMarketAuth.mount('#om-auth', { onSignIn: (u) => console.log(u.email) });</script>
```

Ограничение: `users.txt` публичный, хеши видны всем — пароль от OpenMarket нельзя переиспользовать на сторонних сайтах. Для боевого проекта нужен полноценный OAuth-провайдер.

## Переменные и настройки

- `Constants.kt` — владелец/репозиторий GitHub, адреса API/raw/uploads, имена файлов данных.
- Настройки в приложении и на сайте — токен GitHub хранится только на устройстве/в браузере.
- Код активации администратора выдаётся владельцем магазина.
