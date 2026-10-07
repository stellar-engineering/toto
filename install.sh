#!/usr/bin/env bash
# Installs toto-server on 64-bit Raspberry Pi OS or Debian. Run from a checkout: sudo ./install.sh
# Safe to re-run; it upgrades the server in place and keeps /etc/toto.env and all projects.
#
# With TOTO_IMAGE=1 it prepares a system image instead of a running machine: nothing is started,
# and nothing unique to one device (its token, its name) is created. See image/build.sh.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "run with sudo" >&2; exit 1; }
src="$(cd "$(dirname "$0")" && pwd)"

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
# nftables for the nft tool only: its service, which would replace the whole firewall, is left off.
apt-get install -y git sudo openssh-client tmux nftables bluez rfkill network-manager
command -v claude >/dev/null || npm install -g @anthropic-ai/claude-code

# The server runs unprivileged as `toto`. Each project gets its own user in `toto-projects`.
id toto >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin toto
getent group toto-projects >/dev/null || groupadd --system toto-projects
install -d -o toto -g toto -m 700 /var/lib/toto

install -d /opt/toto /opt/toto/bin
install -m 755 "$src/bin/toto-priv" /opt/toto/bin/toto-priv
install -m 755 "$src/bin/toto-firstboot" /opt/toto/bin/toto-firstboot
# The updater, and the public half of the key a release must be signed with. Root's, like the helper.
install -m 755 "$src/bin/toto-update.mjs" /opt/toto/bin/toto-update.mjs
install -m 644 "$src/release.pub" /opt/toto/release.pub
rm -rf /opt/toto/server
cp -r "$src/server" "$src/protocol.ts" /opt/toto/
rm -rf /opt/toto/server/node_modules
(cd /opt/toto/server && npm install --omit=dev --no-audit --no-fund)

# The device's own tool: `sudo toto` for a live screen, `sudo toto pair` and so on.
printf '#!/bin/sh\nexec /usr/bin/node /opt/toto/server/src/cli.ts "$@"\n' > /usr/local/bin/toto
chmod 755 /usr/local/bin/toto

# toto may manage project users through the helper, and run commands as project users. Nothing else.
sudoers="$(mktemp)"
cat > "$sudoers" <<'EOF'
toto ALL=(root) NOPASSWD: /opt/toto/bin/toto-priv
toto ALL=(%toto-projects) NOPASSWD:SETENV: ALL
EOF
visudo -cf "$sudoers" >/dev/null
install -m 440 "$sudoers" /etc/sudoers.d/toto
rm -f "$sudoers"

cat > /etc/systemd/system/toto.service <<'EOF'
[Unit]
Description=Toto server
# Not network-online: a new device has no network until Toto's Bluetooth setup gives it one.
After=network.target toto-firstboot.service bluetooth.service
Wants=toto-firstboot.service

[Service]
User=toto
WorkingDirectory=/opt/toto/server
EnvironmentFile=/etc/toto.env
ExecStart=/usr/bin/node src/index.ts
Restart=on-failure
# /run/toto, where the socket for the `toto` console tool lives.
RuntimeDirectory=toto
RuntimeDirectoryMode=0750
# Leave terminal agents' tmux sessions running when the server restarts.
KillMode=process

[Install]
WantedBy=multi-user.target
EOF

# Its token, its name and its radios: on this machine now, or on each device when an image first starts.
cat > /etc/systemd/system/toto-firstboot.service <<'EOF'
[Unit]
Description=Toto first-boot setup
Before=toto.service
After=systemd-rfkill.service

[Service]
Type=oneshot
Environment=TOTO_NAME_DEVICE=1 TOTO_DEFAULT_RELAY=wss://toto.royletron.dev
ExecStart=/opt/toto/bin/toto-firstboot

[Install]
WantedBy=multi-user.target
EOF

if [ "${TOTO_IMAGE:-}" = 1 ]; then
  systemctl enable toto toto-firstboot
  echo "Toto is installed into this image."
  exit 0
fi

/opt/toto/bin/toto-firstboot
systemctl daemon-reload
systemctl enable toto
systemctl restart toto

# Only to a person at a terminal: an update runs this too, and its output is kept in the system log.
[ -t 1 ] || exit 0
echo
echo "Toto is running at ws://$(hostname).local:7860"
echo "Token: $(grep '^TOTO_TOKEN=' /etc/toto.env | cut -d= -f2)"
if ! grep -qE '^(ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN)=.+' /etc/toto.env; then
  echo "Next: set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN in /etc/toto.env, then: sudo systemctl restart toto"
fi
