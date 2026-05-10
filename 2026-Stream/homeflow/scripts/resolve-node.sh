#!/bin/sh

set -e

if command -v node >/dev/null 2>&1; then
  command -v node
  exit 0
fi

if [ -n "${NODE_BINARY:-}" ] && [ -x "${NODE_BINARY}" ]; then
  printf '%s\n' "${NODE_BINARY}"
  exit 0
fi

for candidate in \
  "/opt/homebrew/bin/node" \
  "/usr/local/bin/node" \
  "$HOME/.volta/bin/node"
do
  if [ -x "$candidate" ]; then
    printf '%s\n' "$candidate"
    exit 0
  fi
done

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$HOME/.nvm/nvm.sh"
  if command -v node >/dev/null 2>&1; then
    command -v node
    exit 0
  fi
fi

echo "error: Unable to find a working Node.js binary for Xcode." >&2
echo "Install Node with nvm, Volta, Homebrew, or set NODE_BINARY in ios/.xcode.env.local." >&2
exit 1
