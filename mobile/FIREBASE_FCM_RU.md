# Firebase Cloud Messaging — настройка push-уведомлений (Moya)

Гайд по подключению push-уведомлений для продуктового (accounts) инстанса.
Telegram-инстанс это не затрагивает — у него уведомления идут через бота.

Что в итоге получим:
- `google-services.json` → кладётся в приложение (`mobile/android/app/`), даёт ему доступ к FCM.
- `FCM_PROJECT_ID` + `FCM_SA_JSON` → переменные окружения на **продуктовом** сервере, которыми backend подписывает и шлёт пуши.

**Важно про секреты:**
- `google-services.json` — это клиентский конфиг, он зашит в APK и не является секретом (можно коммитить).
- **Сервисный ключ (`FCM_SA_JSON`) — это секрет.** Его кладём только в серверный `/opt/family_hq/.env`, никогда не коммитим.

---

## Шаг 1. Firebase-проект

1. Зайди на https://console.firebase.google.com → **Add project** (или выбери существующий — можно привязать к тому же Google Cloud-проекту, где уже лежит OAuth-клиент для Google-входа).
2. Имя проекта — например `Moya`. Google Analytics можно выключить (необязательно).
3. Дождись создания → **Continue**.

## Шаг 2. Android-приложение → google-services.json

1. На главной проекта нажми иконку **Android** («Add app»).
2. **Android package name:** `com.moyafamily.app` (ровно так, это applicationId приложения).
3. App nickname — `Moya` (необязательно). SHA-1 на этом шаге можно пропустить (для пушей не нужен; он нужен для Google-входа, который уже настроен отдельно).
4. **Register app** → **Download google-services.json**.
5. Положи скачанный файл сюда:
   ```
   mobile/android/app/google-services.json
   ```
   Gradle сам подхватит его при сборке (плагин применяется условно — если файл есть). Остальные шаги визарда («Add Firebase SDK» и т.д.) можно пропустить — Capacitor-плагин уже всё подключил.

## Шаг 3. Сервисный ключ → FCM_SA_JSON + FCM_PROJECT_ID

1. В консоли: шестерёнка ⚙ → **Project settings** → вкладка **Service accounts**.
2. Нажми **Generate new private key** → **Generate key** → скачается JSON-файл (это секрет!).
3. Из этого JSON нам нужно:
   - всё содержимое файла → переменная `FCM_SA_JSON`;
   - значение поля `project_id` → переменная `FCM_PROJECT_ID`.

## Шаг 4. Переменные окружения на продуктовом сервере

На сервере, в `/opt/family_hq/.env` **продуктового** инстанса (тот, что с `AUTH_MODE=accounts`):

```env
FCM_PROJECT_ID=<project_id из ключа>
FCM_SA_JSON=<одной строкой весь JSON сервисного ключа>
```

JSON удобно вставить одной строкой (можно с экранированными переводами строк в `private_key` — там уже `\n`, их трогать не надо). Бэкенд парсит это значение через `json.loads`.

> Telegram-инстанс эти переменные **не задаёт** — там `fcm.configured()` вернёт `False`, и push-канал будет полностью бездействовать.

## Шаг 5. Пересборка и проверка

- **Backend (только продукт):** добавился пакет `PyJWT[crypto]` → пересобрать образ продуктового сервиса:
  ```
  cd /opt/family_hq && git pull origin v6 && docker compose build product && docker compose up -d product
  ```
  (сервис `app` — Telegram — не трогаем).
- **Приложение:** в Android Studio → **Sync Project with Gradle Files** (увидит `google-services.json` и применит плагин) → **Run ▶**.
- На устройстве: при первом входе (после онбординга) появится экран «Будь в курсе» → **Включить уведомления** → системный промпт Android → **Allow**.
- Проверка регистрации: в логах сервера должен прийти `POST /api/push/register` с токеном.
- E2E: создай задачу с напоминанием «на сейчас» → через минуту прилетит push. Тап по нему открывает приложение.
- Тумблер «Push-уведомления» в Настройках выключает/включает доставку на это устройство.

---

## Где это в коде

- `backend/fcm.py` — минт OAuth2-токена сервис-аккаунта (PyJWT) + отправка в FCM HTTP v1.
- `backend/scheduler.py` — `_notify_user` / `_notify_all` шлют параллельно в Telegram и в push.
- `backend/app.py` — `POST /api/push/register` и `/api/push/unregister`.
- `backend/migrate.py` — таблица `push_tokens` (v42).
- `frontend/push.js` — разрешение, регистрация токена, тап-открытие, тумблер.
