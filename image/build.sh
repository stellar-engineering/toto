#!/usr/bin/env bash
# Builds a flashable Toto image: the smallest official Raspberry Pi OS (Lite, 64-bit) with Toto
# installed and ready to be set up from a phone.
#
# Run as root on 64-bit ARM Linux, from a checkout. A Raspberry Pi is the easy place to do it,
# since the image's own programs then run natively while it is being prepared:
#   sudo image/build.sh
# The result is toto.img.xz in the work directory (default /var/tmp/toto-image).
#
# ponytail: customises the official image rather than building one from packages with pi-gen.
# Much faster and much less to maintain; switch if we ever need to remove things Lite includes.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "run with sudo" >&2; exit 1; }
[ "$(uname -m)" = aarch64 ] || { echo "needs 64-bit ARM: the image's programs are run while preparing it" >&2; exit 1; }
src="$(cd "$(dirname "$0")/.." && pwd)"
work="${TOTO_IMAGE_WORK:-/var/tmp/toto-image}"
base_url="${TOTO_IMAGE_BASE:-https://downloads.raspberrypi.com/raspios_lite_arm64_latest}"
mkdir -p "$work" && cd "$work"

[ -f base.img.xz ] || { echo "Downloading the base image…"; curl -fL -o base.img.xz.part "$base_url" && mv base.img.xz.part base.img.xz; }

echo "Unpacking…"
rm -f toto.img toto.img.xz
xz -dc base.img.xz > toto.img
# Room for Node, Claude Code, a browser and Toto. The system grows to fill the card on first boot anyway.
truncate -s +2500M toto.img
parted -s toto.img resizepart 2 100%

loop="$(losetup --find --show --partscan toto.img)"
root="$work/root"
cleanup() {
  for m in dev/pts dev sys proc boot/firmware ''; do umount "$root/$m" 2>/dev/null || true; done
  losetup -d "$loop" 2>/dev/null || true
}
trap cleanup EXIT
e2fsck -fp "${loop}p2" >/dev/null || true
resize2fs "${loop}p2" >/dev/null

mkdir -p "$root"
mount "${loop}p2" "$root"
mount "${loop}p1" "$root/boot/firmware"
mount -t proc proc "$root/proc"
mount -t sysfs sys "$root/sys"
mount --bind /dev "$root/dev"
mount --bind /dev/pts "$root/dev/pts"

echo "Installing Toto into the image…"
mkdir -p "$root/opt/toto-src"
rsync -a --delete --exclude node_modules --exclude .git --exclude app --exclude relay "$src/" "$root/opt/toto-src/"
# The image needs the internet while it is prepared, and has no resolver of its own yet.
resolv="$root/etc/resolv.conf"
[ -L "$resolv" ] && { mv "$resolv" "$resolv.toto-keep"; }
cp /etc/resolv.conf "$resolv"
chroot "$root" /bin/bash /opt/toto-src/image/inside.sh
rm -f "$resolv"
[ -L "$resolv.toto-keep" ] && mv "$resolv.toto-keep" "$resolv"
rm -rf "$root/opt/toto-src"

echo "Packing…"
# Blocks the installation freed are zeroed so they compress away.
fstrim "$root" 2>/dev/null || true
cleanup
trap - EXIT
xz -T0 -5 toto.img
ls -lh "$work/toto.img.xz"
echo "Flash it with Raspberry Pi Imager: Choose OS, Use custom, then this file."
