#!/usr/bin/env bash
# Build the Go client for this machine: packages/go/openmeet, stamped with the version in
# packages/terminal/package.json so both clients report the one version.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$HERE/../terminal/package.json")"
cd "$HERE"
go build -tags nolibopusfile -trimpath -ldflags "-s -w -X main.Version=$VERSION" -o openmeet ./cmd/openmeet
ls -la openmeet
