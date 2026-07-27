#!/usr/bin/env bash
# Запускает НАСТОЯЩЕЕ приложение Hermest Board, а не статичную оболочку.
#
# Почему это вообще нужно. index.html подключает модуль абсолютным путём
# (`/src/app.js`), а локальный медиаконвейер живёт в vite-плагине как
# /api/local-media/*. Открытый через file:// борд не грузит ни модуль, ни API:
# получается мёртвая разметка — то самое «демо», которое нельзя использовать.
# Поэтому ярлык обязан поднять локальный сервер и открыть его по http://127.0.0.1.
#
# Сервер слушает только петлевой интерфейс. Наружу не открывается ничего.
set -Eeuo pipefail

REPO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/hermest-board"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/hermest-board"
LOG_FILE="$STATE_DIR/server.log"
BROWSER_PROFILE="$DATA_DIR/browser-profile"
MODE="preview"
SERVER_PID=""

mkdir -p "$STATE_DIR" "$DATA_DIR"

for arg in "$@"; do
  case "$arg" in
    --dev) MODE="dev" ;;
    --preview) MODE="preview" ;;
    --help|-h)
      printf 'Использование: %s [--preview|--dev]\n' "$(basename "$0")"
      printf '  --preview  собранная сборка (по умолчанию, быстрее стартует)\n'
      printf '  --dev      dev-сервер vite с HMR\n'
      exit 0 ;;
    *) printf 'Неизвестный аргумент: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

fail() {
  printf 'Hermest Board: %s\n' "$1" >&2
  if command -v zenity >/dev/null 2>&1; then
    zenity --error --no-markup --title="Hermest Board" --text="$1" 2>/dev/null || true
  fi
  exit 1
}

cleanup() {
  # Сервер поднимали мы — мы же его и гасим, вместе с детьми vite.
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill -TERM -- "-$SERVER_PID" 2>/dev/null || kill -TERM "$SERVER_PID" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$SERVER_PID" 2>/dev/null || break
      sleep 0.2
    done
    kill -KILL -- "-$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

command -v node >/dev/null 2>&1 || fail "не найден node — установите Node.js 20 или новее"
command -v npm  >/dev/null 2>&1 || fail "не найден npm"

cd "$REPO_DIR"

[[ -d node_modules/vite ]] || {
  printf 'Первый запуск: ставлю зависимости…\n'
  npm install --no-audit --no-fund >>"$LOG_FILE" 2>&1 || fail "npm install не прошёл, лог: $LOG_FILE"
}

if [[ "$MODE" == "preview" ]]; then
  # Пересобираем, только если сборки нет или исходники новее её.
  if [[ ! -f dist/index.html ]] || [[ -n "$(find src index.html vite.config.mjs -newer dist/index.html -print -quit 2>/dev/null)" ]]; then
    printf 'Собираю приложение…\n'
    npm run build >>"$LOG_FILE" 2>&1 || fail "сборка не прошла, лог: $LOG_FILE"
  fi
fi

# Свободный порт выбираем сами: strictPort даёт предсказуемый адрес,
# а «занято» мы обходим до старта, а не после.
PORT="$(node -e '
const net = require("node:net");
const server = net.createServer();
server.listen(0, "127.0.0.1", () => {
  const { port } = server.address();
  server.close(() => process.stdout.write(String(port)));
});
')"
[[ "$PORT" =~ ^[0-9]+$ ]] || fail "не удалось выбрать свободный порт"

URL="http://127.0.0.1:$PORT/"
printf 'Запускаю Hermest Board на %s (режим: %s)\n' "$URL" "$MODE"

{
  printf '\n=== %s | режим %s | порт %s ===\n' "$(date -Is)" "$MODE" "$PORT"
} >>"$LOG_FILE"

# setsid: сервер получает свою группу процессов, поэтому гасится целиком.
if [[ "$MODE" == "dev" ]]; then
  setsid npm run dev -- --port "$PORT" --strictPort >>"$LOG_FILE" 2>&1 &
else
  setsid npm run preview -- --port "$PORT" --strictPort >>"$LOG_FILE" 2>&1 &
fi
SERVER_PID=$!

for _ in $(seq 1 100); do
  if curl -fsS -m 2 -o /dev/null "$URL"; then break; fi
  kill -0 "$SERVER_PID" 2>/dev/null || fail "сервер завершился на старте, лог: $LOG_FILE"
  sleep 0.2
done
curl -fsS -m 3 -o /dev/null "$URL" || fail "сервер не ответил за 20 с, лог: $LOG_FILE"

BROWSER=""
for candidate in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge; do
  if command -v "$candidate" >/dev/null 2>&1; then BROWSER="$candidate"; break; fi
done

if [[ -n "$BROWSER" ]]; then
  # Отдельный профиль обязателен: с общим профилем chrome --app просто передаёт
  # запрос уже запущенному процессу и выходит, скрипт считает окно закрытым и
  # гасит сервер под ногами у пользователя.
  "$BROWSER" \
    --user-data-dir="$BROWSER_PROFILE" \
    --no-first-run \
    --no-default-browser-check \
    --app="$URL" >>"$LOG_FILE" 2>&1 || true
else
  command -v xdg-open >/dev/null 2>&1 || fail "не найден браузер — откройте вручную: $URL"
  xdg-open "$URL" >>"$LOG_FILE" 2>&1 || true
  printf 'Окно открыто во внешнем браузере. Сервер работает, пока открыт этот терминал.\n'
  printf 'Остановить: Ctrl+C\n'
  while kill -0 "$SERVER_PID" 2>/dev/null; do sleep 1; done
fi
