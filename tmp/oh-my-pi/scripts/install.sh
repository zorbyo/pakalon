#!/usr/bin/env bash
# Pakalon CLI installer for macOS and Linux.
# Usage: curl -fsSL https://pakalon.dev/install | sh
#
# Environment variables:
#   PAKALON_VERSION    Pin a specific version (default: latest)
#   PAKALON_INSTALL    Install dir (default: $HOME/.local/bin)
#   PAKALON_NO_ALIAS   If set, skip creating the `omp` symlink
#   PAKALON_GITHUB     GitHub repo (default: pakalon/pakalon-cli)
#
# This script never touches PATH. It writes the binary to
# $PAKALON_INSTALL (creating the directory if missing) and prints a
# hint about adding that directory to your shell's PATH.

set -euo pipefail

GITHUB_REPO="${PAKALON_GITHUB:-pakalon/pakalon-cli}"
INSTALL_DIR="${PAKALON_INSTALL:-$HOME/.local/bin}"
VERSION="${PAKALON_VERSION:-latest}"
SKIP_ALIAS="${PAKALON_NO_ALIAS:-}"

# Detect platform
OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
	Linux) PLATFORM=linux ;;
	Darwin) PLATFORM=darwin ;;
	*) echo "pakalon: unsupported OS: $OS" >&2; exit 1 ;;
esac
case "$ARCH" in
	x86_64|amd64) ARCH=linux-x64 ;;
	arm64|aarch64)
		case "$OS" in
			Linux) ARCH=linux-arm64 ;;
			Darwin) ARCH=darwin-arm64 ;;
			*) echo "pakalon: unsupported arch: $ARCH on $OS" >&2; exit 1 ;;
		esac
		;;
	*) echo "pakalon: unsupported arch: $ARCH" >&2; exit 1 ;;
esac
EXT=""
[ "$PLATFORM" = "windows" ] && EXT=".exe"
ASSET="pakalon-${PLATFORM}-${ARCH}${EXT}"

# Resolve the version → release tag
if [ "$VERSION" = "latest" ]; then
	TAG="$(curl -fsSL "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" \
		| grep -m1 '"tag_name"' \
		| sed -E 's/.*"([^"]+)".*/\1/')"
else
	TAG="$VERSION"
fi

URL="https://github.com/${GITHUB_REPO}/releases/download/${TAG}/${ASSET}"

# Make sure the install dir exists
mkdir -p "$INSTALL_DIR"

echo "Installing pakalon ${TAG} (${PLATFORM}/${ARCH}) → ${INSTALL_DIR}/pakalon"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL -o "$TMP/$ASSET" "$URL"
chmod +x "$TMP/$ASSET"
mv "$TMP/$ASSET" "$INSTALL_DIR/pakalon"

# Backward-compat alias
if [ -z "$SKIP_ALIAS" ] && [ ! -e "$INSTALL_DIR/omp" ]; then
	ln -sf pakalon "$INSTALL_DIR/omp"
	echo "Created 'omp' symlink for backward compatibility."
fi

echo
echo "✓ pakalon installed to ${INSTALL_DIR}/pakalon"
echo
case ":$PATH:" in
	*":$INSTALL_DIR:"*) echo "Run: pakalon --help" ;;
	*) echo "Add to PATH and run: export PATH=\"$INSTALL_DIR:\$PATH\" && pakalon --help" ;;
esac
