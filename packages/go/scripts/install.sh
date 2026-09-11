#!/usr/bin/env bash
# OpenMeet for macOS, one binary: the latest release into ~/.local/bin.
#   curl -fsSL https://raw.githubusercontent.com/manuelvegadev/openmeet/main/packages/go/scripts/install.sh | bash
# Screen sharing and watching peers need ffmpeg (brew install ffmpeg); audio and chat do not.
set -euo pipefail
REPO=manuelvegadev/openmeet
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) ASSET=openmeet-darwin-arm64 ;;
  *) echo "OpenMeet's binary is built for Apple Silicon Macs (and Windows); see the README for other machines." >&2; exit 1 ;;
esac
DIR="${OPENMEET_DIR:-$HOME/.local/bin}"
mkdir -p "$DIR"
URL="https://github.com/$REPO/releases/latest/download/$ASSET"
echo "downloading $URL"
curl -fsSL -o "$DIR/openmeet.new" "$URL"
chmod +x "$DIR/openmeet.new"
mv -f "$DIR/openmeet.new" "$DIR/openmeet"
# Unsigned for now: clear the quarantine flag so Gatekeeper does not refuse it.
xattr -d com.apple.quarantine "$DIR/openmeet" 2>/dev/null || true
echo "installed $("$DIR/openmeet" --version) at $DIR/openmeet"
case ":$PATH:" in *":$DIR:"*) ;; *) echo "add $DIR to your PATH, then run: openmeet" ;; esac
command -v ffmpeg >/dev/null || echo "for screen sharing: brew install ffmpeg"
