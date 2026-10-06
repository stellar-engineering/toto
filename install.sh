#!/usr/bin/env bash
# Installs toto-server on 64-bit Raspberry Pi OS or Debian. Run from a checkout: sudo ./install.sh
# Safe to re-run; it upgrades the server in place and keeps /etc/toto.env and all projects.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "run with sudo" >&2; exit 1; }
src="$(cd "$(dirname "$0")" && pwd)"

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
apt-get install -y git sudo openssh-client
command -v claude >/dev/null || npm install -g @anthropic-ai/claude-code

# The server runs unprivileged as `toto`. Each project gets its own user in `toto-projects`.
id toto >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin toto
getent group toto-projects >/dev/null || groupadd --system toto-projects
install -d -o toto -g toto -m 700 /var/lib/toto

install -d /opt/toto /opt/toto/bin
install -m 755 "$src/bin/toto-priv" /opt/toto/bin/toto-priv
rm -rf /opt/toto/server
cp -r "$src/server" "$src/protocol.ts" /opt/toto/
rm -rf /opt/toto/server/node_modules
(cd /opt/toto/server && npm install --omit=dev --no-audit --no-fund)

# toto may manage project users through the helper, and run commands as project users. Nothing else.
sudoers="$(mktemp)"
cat > "$sudoers" <<'EOF'
toto ALL=(root) NOPASSWD: /opt/toto/bin/toto-priv
toto ALL=(%toto-projects) NOPASSWD:SETENV: ALL
EOF
visudo -cf "$sudoers" >/dev/null
install -m 440 "$sudoers" /etc/sudoers.d/toto
rm -f "$sudoers"

if [ ! -f /etc/toto.env ]; then
  (umask 077; printf 'TOTO_TOKEN=%s\n# One of these: an API key, or a subscription token from `claude setup-token`.\nANTHROPIC_API_KEY=\nCLAUDE_CODE_OAUTH_TOKEN=\n' "$(openssl rand -hex 16)" > /etc/toto.env)
fi
grep -q '^TOTO_ISOLATE=' /etc/toto.env || echo 'TOTO_ISOLATE=1' >> /etc/toto.env
grep -q '^TOTO_DATA_DIR=' /etc/toto.env || echo 'TOTO_DATA_DIR=/var/lib/toto' >> /etc/toto.env

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
if ! grep -qE '^(ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN)=.+' /etc/toto.env; then
  echo "Next: set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN in /etc/toto.env, then: sudo systemctl restart toto"
fi
