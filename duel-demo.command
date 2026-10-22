#!/bin/bash
# Демо-бой: сервер + два скриптовых бота + браузер. Лимиты подписки не тратятся.
cd "$(dirname "$0")"
pkill -f "node server.js" 2>/dev/null; pkill -f "node agent.js" 2>/dev/null; sleep 1
PORT=8799 node server.js & sleep 1
open "http://localhost:8799"
node agent.js P1 jarvis --demo &
node agent.js P2 nemesis --demo &
echo "Демо-бой идёт. Закрой окно, чтобы остановить."
wait
