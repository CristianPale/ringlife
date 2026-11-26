#!/bin/sh
# Attiva gli hook versionati in .githooks (una volta per clone).
# Su Windows lanciare da Git Bash.
set -e
cd "$(git rev-parse --show-toplevel)"
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit 2>/dev/null || true
echo "Hook attivi: core.hooksPath = .githooks"
if ! command -v gitleaks >/dev/null 2>&1; then
  echo "Attenzione: gitleaks non e' installato, il pre-commit bloccherebbe ogni commit." >&2
  echo "  Windows: winget install Gitleaks.Gitleaks" >&2
  echo "  macOS:   brew install gitleaks" >&2
fi
