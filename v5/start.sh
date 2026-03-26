#!/bin/bash
uvicorn backend.app:app --host 0.0.0.0 --port 8000 &
python -m backend.bot
