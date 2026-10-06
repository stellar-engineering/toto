#!/usr/bin/env bash
# Installs toto-server on stock 64-bit Raspberry Pi OS. Run from a checkout: sudo ./install.sh
# Safe to re-run; it upgrades the server in place and keeps /etc/toto.env.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "run with sudo" >&2; exit 1; }
src="$(cd "$(dirname "$0")" && pwd)"

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
apt-get install -y git
command -v claude >/dev/null || npm install -g @anthropic-ai/claude-code

id toto >/dev/null 2>&1 || useradd --create-home --shell /bin/bash toto
# ponytail: one hard-coded project. M1 replaces this with a Linux user and clone per project.
install -d -o toto -g toto /home/toto/project

install -d /opt/toto
rm -rf /opt/toto/server
cp -r "$src/server" "$src/protocol.ts" /opt/toto/
rm -rf /opt/toto/server/node_modules
(cd /opt/toto/server && npm install --omit=dev --no-audit --no-fund)

if [ ! -f /etc/toto.env ]; then
  umask 077
  cat > /etc/toto.env <<EOF
TOTO_TOKEN=$(openssl rand -hex 16)
TOTO_PROJECT_DIR=/home/toto/project
ANTHROPIC_API_KEY=
EOF
fi

cat > /etc/systemd/system/toto.service <<'EOF'
[Unit]
Description=Toto server
After=network-online.target
Wants=network-online.target

[Service]
User=toto
WorkingDirectory=/opt/toto/server
EnvironmentFile=/etc/toto.env
ExecStart=/usr/bin/node src/index.ts
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable toto
systemctl restart toto

echo
echo "Toto is running at ws://$(hostname).local:7860"
echo "Token: $(grep '^TOTO_TOKEN=' /etc/toto.env | cut -d= -f2)"
if grep -q '^ANTHROPIC_API_KEY=$' /etc/toto.env; then
  echo "Next: put your key in /etc/toto.env (ANTHROPIC_API_KEY=...) then: sudo systemctl restart toto"
fi
