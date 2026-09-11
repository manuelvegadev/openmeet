#!/usr/bin/env bash
# Build the Go client for this machine: packages/go/openmeet, stamped with the version in
# packages/terminal/package.json so both clients report the one version.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$HERE/../terminal/package.json")"
CROSS="$HERE/.cross"
OPUS_VER=1.5.2

# libopus, static, for this machine: the one C dependency not in the tree, and the binary
# has to run on a Mac without Homebrew. Built once with cmake and cached; the .pc points
# pkg-config at a directory holding only the static archive, so that is what links.
if [ ! -f "$CROSS/opus-host/lib/libopus.a" ]; then
  echo "building libopus $OPUS_VER for this machine..."
  mkdir -p "$CROSS"
  [ -f "$CROSS/opus-$OPUS_VER.tar.gz" ] || curl -sSL -o "$CROSS/opus-$OPUS_VER.tar.gz" "https://downloads.xiph.org/releases/opus/opus-$OPUS_VER.tar.gz"
  [ -d "$CROSS/opus-$OPUS_VER" ] || tar xzf "$CROSS/opus-$OPUS_VER.tar.gz" -C "$CROSS"
  cmake -S "$CROSS/opus-$OPUS_VER" -B "$CROSS/opus-host-build" -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$CROSS/opus-host" \
    -DOPUS_BUILD_SHARED_LIBRARY=OFF -DOPUS_BUILD_PROGRAMS=OFF -DOPUS_BUILD_TESTING=OFF > "$CROSS/opus-host-cmake.log" 2>&1
  cmake --build "$CROSS/opus-host-build" --parallel > "$CROSS/opus-host-build.log" 2>&1
  cmake --install "$CROSS/opus-host-build" > /dev/null
fi
mkdir -p "$CROSS/pkgconfig-host"
cat > "$CROSS/pkgconfig-host/opus.pc" <<PC
prefix=$CROSS/opus-host
includedir=\${prefix}/include
libdir=\${prefix}/lib
Name: opus
Description: Opus codec, static
Version: $OPUS_VER
Cflags: -I\${includedir}/opus
Libs: -L\${libdir} -lopus
PC

cd "$HERE"
PKG_CONFIG_PATH="$CROSS/pkgconfig-host" go build -tags nolibopusfile -trimpath -ldflags "-s -w -X main.Version=$VERSION" -o openmeet ./cmd/openmeet
ls -la openmeet
