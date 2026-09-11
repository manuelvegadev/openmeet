#!/usr/bin/env bash
# Cross-build the Go client for Windows from macOS (or Linux).
#
#   packages/go/scripts/build-windows.sh            → packages/go/dist/windows-amd64/openmeet.exe
#
# Needs zig (`brew install zig`), cmake and pkg-config on the host. libopus is the one C
# dependency that is not compiled into the binary from source, so it is built here once,
# statically, for x86_64-windows-gnu, and cached under packages/go/.cross. miniaudio is in
# the tree already (internal/audio/shim.c) and needs nothing.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
CROSS="$HERE/.cross"
TARGET=x86_64-windows-gnu
OPUS_VER=1.5.2
OUT="$HERE/dist/windows-amd64/openmeet.exe"
VERSION="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$HERE/../terminal/package.json")"

mkdir -p "$CROSS/bin" "$HERE/dist/windows-amd64"
# zig as a drop-in C toolchain for the target; cmake wants single executables.
for tool in cc ar ranlib rc; do
  printf '#!/bin/sh\nexec zig %s %s "$@"\n' "$tool" "$([ "$tool" = cc ] && echo "-target $TARGET" || true)" > "$CROSS/bin/z$tool"
  chmod +x "$CROSS/bin/z$tool"
done

if [ ! -f "$CROSS/opus/lib/libopus.a" ]; then
  echo "building libopus $OPUS_VER for $TARGET..."
  [ -f "$CROSS/opus-$OPUS_VER.tar.gz" ] || curl -sSL -o "$CROSS/opus-$OPUS_VER.tar.gz" "https://downloads.xiph.org/releases/opus/opus-$OPUS_VER.tar.gz"
  [ -d "$CROSS/opus-$OPUS_VER" ] || tar xzf "$CROSS/opus-$OPUS_VER.tar.gz" -C "$CROSS"
  cmake -S "$CROSS/opus-$OPUS_VER" -B "$CROSS/opus-build" \
    -DCMAKE_SYSTEM_NAME=Windows -DCMAKE_SYSTEM_PROCESSOR=AMD64 \
    -DCMAKE_C_COMPILER="$CROSS/bin/zcc" -DCMAKE_AR="$CROSS/bin/zar" -DCMAKE_RANLIB="$CROSS/bin/zranlib" \
    -DCMAKE_RC_COMPILER="$CROSS/bin/zrc" \
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$CROSS/opus" \
    -DOPUS_BUILD_SHARED_LIBRARY=OFF -DOPUS_BUILD_PROGRAMS=OFF -DOPUS_BUILD_TESTING=OFF -DOPUS_STACK_PROTECTOR=OFF \
    > "$CROSS/opus-cmake.log" 2>&1
  cmake --build "$CROSS/opus-build" --parallel > "$CROSS/opus-build.log" 2>&1
  cmake --install "$CROSS/opus-build" > /dev/null
fi

# A .pc that points at the cross build: hraban/opus finds libopus through pkg-config.
mkdir -p "$CROSS/pkgconfig"
cat > "$CROSS/pkgconfig/opus.pc" <<PC
prefix=$CROSS/opus
includedir=\${prefix}/include
libdir=\${prefix}/lib
Name: opus
Description: Opus codec, static, $TARGET
Version: $OPUS_VER
Cflags: -I\${includedir}/opus
Libs: -L\${libdir} -lopus
PC

echo "building $OUT..."
cd "$HERE"
PKG_CONFIG_PATH="$CROSS/pkgconfig" CGO_ENABLED=1 GOOS=windows GOARCH=amd64 \
  CC="$CROSS/bin/zcc" CGO_LDFLAGS="-static" \
  go build -tags nolibopusfile -trimpath -ldflags "-s -w -X main.Version=$VERSION" -o "$OUT" ./cmd/openmeet
ls -la "$OUT"
