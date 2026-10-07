#!/usr/bin/env bash
# Redraws every icon from assets/source/mark.html. Run from the app folder after changing the mark:
#   ./assets/make-icons.sh
# Needs Google Chrome, which does the drawing.
set -euo pipefail
cd "$(dirname "$0")"
chrome="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
draw() { # kind, pixels, output file
  # Always drawn at 1024 and scaled down: Chrome will not make a window as small as the small icons.
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --default-background-color=00000000 --window-size=1024,1024 --virtual-time-budget=2000 \
    --screenshot="$PWD/$3" "file://$PWD/source/mark.html#$1" >/dev/null 2>&1
  [ "$2" = 1024 ] || sips -Z "$2" "$3" >/dev/null
  echo "$3 ($2px)"
}
draw icon 1024 icon.png
draw foreground 1024 android-icon-foreground.png
draw monochrome 1024 android-icon-monochrome.png
draw splash 1024 splash-icon.png
draw notification 96 notification-icon.png
draw favicon 48 favicon.png
