#!/bin/bash
# Поднимает локальный сервер в папке, где лежит этот скрипт,
# и сразу открывает сайт в браузере.
#
# Зачем это вообще нужно: annotator.js использует fetch() для чтения
# исходного HTML (чтобы показывать номер строки элемента). fetch()
# не работает на file:// — только через http(s)://. Поэтому сайт
# на этапе разработки с annotator.js нужно открывать через сервер,
# а не двойным кликом по index.html.
#
# Запуск:  ./serve.sh   (или  bash serve.sh)

cd "$(dirname "$0")"

PORT=8000

if command -v npx >/dev/null 2>&1; then
  echo "Запускаю сервер через npx serve на порту $PORT..."
  npx --yes serve . -l $PORT
elif command -v python3 >/dev/null 2>&1; then
  echo "Запускаю сервер через python3 на порту $PORT..."
  echo "Открой в браузере: http://localhost:$PORT"
  python3 -m http.server $PORT
else
  echo "Не найден ни npx (Node.js), ни python3."
  echo "Установи Node.js (nodejs.org) или Python 3, и запусти скрипт снова."
  exit 1
fi
