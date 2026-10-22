#!/bin/bash
# Настоящий бой: сервер + два ИИ на Haiku (claude -p) + браузер.
# Тратит лимиты подписки Claude Code (Haiku дёшев). Нужен включённый claude в PATH.
cd "$(dirname "$0")"
pkill -f "node server.js" 2>/dev/null; pkill -f "node agent.js" 2>/dev/null; sleep 1
PORT=8799 node server.js & sleep 1
open "http://localhost:8799"
node agent.js P1 jarvis &
node agent.js P2 nemesis &
echo "ИИ-бой идёт (Haiku). Закрой окно, чтобы остановить."
wait
