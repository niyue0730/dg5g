#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_VERSION="24.15.0"
NODE_NAME="node-v${NODE_VERSION}-darwin-arm64"
NODE_DIR="${ROOT_DIR}/runtime/${NODE_NAME}"
NODE_ARCHIVE="${ROOT_DIR}/runtime/${NODE_NAME}.tar.gz"
NODE_URL="https://nodejs.org/download/release/v${NODE_VERSION}/${NODE_NAME}.tar.gz"

ensure_runtime() {
  if [[ ! -x "${NODE_DIR}/bin/node" ]]; then
    mkdir -p "${ROOT_DIR}/runtime"
    curl -L --fail --retry 3 -o "${NODE_ARCHIVE}" "${NODE_URL}"
    tar -xzf "${NODE_ARCHIVE}" -C "${ROOT_DIR}/runtime"
  fi

  export PATH="${NODE_DIR}/bin:${PATH}"

  if [[ "$(pnpm --version 2>/dev/null || true)" != "9.15.0" ]]; then
    corepack enable
    corepack prepare pnpm@9.15.0 --activate
  fi
}

usage() {
  cat <<'EOF'
Usage: scripts/local-macos.sh <command>

Commands:
  setup    Install dependencies and reset the demo database
  dev      Start the local development server at http://127.0.0.1:3157
  reset    Reset the three demo students and classroom data
  verify   Verify the SQLite database
  build    Run type checking and the production build
  test     Run the repository web unit tests
EOF
}

main() {
  local command="${1:-dev}"

  ensure_runtime
  cd "${ROOT_DIR}"

  case "${command}" in
    setup)
      pnpm install --frozen-lockfile
      pnpm --filter @dgbook/web db:reset:demo
      pnpm --filter @dgbook/web db:verify
      ;;
    dev)
      exec pnpm dev
      ;;
    reset)
      pnpm --filter @dgbook/web db:reset:demo
      pnpm --filter @dgbook/web db:verify
      ;;
    verify)
      pnpm --filter @dgbook/web db:verify
      ;;
    build)
      pnpm typecheck
      pnpm build
      ;;
    test)
      pnpm web:test:unit
      ;;
    *)
      usage
      exit 2
      ;;
  esac
}

main "$@"
