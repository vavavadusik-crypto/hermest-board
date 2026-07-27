#!/usr/bin/env bash
# Ставит ярлык, который открывает настоящее приложение.
#
# Ярлык, указывающий прямо на index.html через file://, открывает мёртвую
# разметку: модуль подключён абсолютным путём и не грузится, локального API
# нет. Поэтому Exec всегда указывает на hermest-desktop.sh.
set -Eeuo pipefail

REPO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
LAUNCHER="$REPO_DIR/scripts/hermest-desktop.sh"
ICON="$REPO_DIR/hermest-board.svg"
APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ENTRY_NAME="hermest-board.desktop"

[[ -x "$LAUNCHER" ]] || { printf 'Не найден исполняемый %s\n' "$LAUNCHER" >&2; exit 1; }
mkdir -p "$APPS_DIR"

write_entry() {
  cat >"$1" <<ENTRY
[Desktop Entry]
Version=1.0
Type=Application
Name=Hermest Board
GenericName=AI video studio
Comment=Локальная студия: тема — раскадровка — озвучка — готовый MP4
Exec=$LAUNCHER
Icon=$ICON
Terminal=false
Categories=AudioVideo;Video;Development;
Keywords=video;ai;storyboard;render;hermest;
StartupNotify=true
StartupWMClass=hermest-board
ENTRY
  chmod +x "$1"
}

write_entry "$APPS_DIR/$ENTRY_NAME"
printf 'Ярлык установлен: %s\n' "$APPS_DIR/$ENTRY_NAME"

# Рабочий стол у пользователя может называться по-разному.
DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
[[ -d "${DESKTOP_DIR:-}" ]] || DESKTOP_DIR="$HOME/Desktop"
if [[ -d "$DESKTOP_DIR" ]]; then
  write_entry "$DESKTOP_DIR/Hermest Board.desktop"
  gio set "$DESKTOP_DIR/Hermest Board.desktop" metadata::trusted true 2>/dev/null || true
  printf 'Ярлык на рабочем столе обновлён: %s\n' "$DESKTOP_DIR/Hermest Board.desktop"
fi

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS_DIR" 2>/dev/null || true
