#!/bin/bash
# Releases the Android app from this machine: builds it here, puts the build on EAS for anyone
# on the team to install, and marks the commit with an app tag.
#
#   app/release.sh           build an APK, upload it to EAS, tag app-v<version>
#   app/release.sh --play    the same, and also build the bundle Google Play wants and send it
#                            to Play's internal testing track
#
# The version is `expo.version` in app.json. Bump it, commit and push before running this: a
# version is released once. Building here, with EAS's local build, uses none of EAS's build
# minutes; EAS still holds the signing key and this machine's `eas login` is what fetches it.
#
# App tags are app-v1.2.3. Server releases are v1.2.3, and only those become GitHub Releases:
# a Toto updates from whatever GitHub calls the latest release, so an app release there would
# be offered to every Toto as its next update.
set -euo pipefail
cd "$(dirname "$0")"
die() { echo "release: $*" >&2; exit 1; }

version="$(node -p "require('./app.json').expo.version")"
tag="app-v$version"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "the version in app.json is not three numbers: $version"
[ -z "$(git status --porcelain)" ] || die "there are uncommitted changes. The build is made from what is committed."
[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || die "releases are made from main."
git fetch -q origin
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || die "main here and on GitHub differ. Push or pull first."
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null && [ "$(git rev-parse "$tag^{commit}")" != "$(git rev-parse HEAD)" ]; then
  die "$tag already marks an earlier commit. Bump the version in app.json for a new release."
fi

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$JAVA_HOME/bin:$PATH"
[ -x "$JAVA_HOME/bin/java" ] || die "no Java at $JAVA_HOME. Set JAVA_HOME to a JDK 17."
[ -d "$ANDROID_HOME" ] || die "no Android SDK at $ANDROID_HOME. Set ANDROID_HOME."
eas() { npx --yes eas-cli@latest "$@"; }

echo "Checking ${version}…"
npx tsc --noEmit

out="${TOTO_BUILDS:-$HOME/Downloads}"
apk="$out/toto-$version.apk"
echo "Building the APK here…"
eas build --platform android --profile preview --local --non-interactive --output "$apk"
echo "Putting it on EAS…"
eas upload --platform android --build-path "$apk" --non-interactive

if [ "${1:-}" = --play ]; then
  aab="$out/toto-$version.aab"
  echo "Building the bundle for Google Play…"
  eas build --platform android --profile production --local --non-interactive --output "$aab"
  echo "Sending it to Play's internal testing…"
  eas submit --platform android --profile production --path "$aab" --non-interactive
fi

git rev-parse -q --verify "refs/tags/$tag" >/dev/null || git tag "$tag"
git push -q origin "$tag"
echo "Released $tag. The APK is at $apk."
