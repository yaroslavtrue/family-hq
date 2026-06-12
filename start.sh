#!/bin/bash
if [ "$AUTH_MODE" = "accounts" ]; then
  # Product instance (Moya, accounts mode): API only, no Telegram bot.
  exec uvicorn backend.app:app --host 0.0.0.0 --port 8000
else
  # Telegram instance: API in background + bot in foreground (unchanged).
  uvicorn backend.app:app --host 0.0.0.0 --port 8000 &
  python -m backend.bot
fi
