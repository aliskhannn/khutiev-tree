#!/usr/bin/env bash
set -eu

cd -- "$(dirname -- "$0")/.."
url='http://127.0.0.1:4178/'

site_ready() {
  local page
  page=$(curl --noproxy '*' --fail --silent --max-time 1 "$url") &&
    [[ "$page" == *'<title>Хутиевы</title>'* && "$page" == *'id="tree-pane"'* ]]
}

if systemctl --user start --no-block khutiev-tree.service; then
  for ((attempt = 0; attempt < 50; attempt++)); do
    if site_ready; then exec xdg-open "$url"; fi
    sleep 0.2
  done
elif site_ready; then
  exec xdg-open "$url"
fi

message="Не удалось открыть сайт. Журнал запуска можно посмотреть командой journalctl --user -u khutiev-tree.service."
echo "$message" >&2
notify-send 'Родословная Хутиевых' "$message" || true
exit 1
