#!/usr/bin/env bash
set -euo pipefail

# MCP-native validation hook: run minimal checks against changed files via browser-executed CI
# This script is intended to be executed in CI or locally to validate compose/services health readiness.

ROOT_DIR=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
cd "$ROOT_DIR"

GREEN="\033[32m"; RED="\033[31m"; YELLOW="\033[33m"; NC="\033[0m"

pass() { echo -e "${GREEN}✔${NC} $*"; }
fail() { echo -e "${RED}✘${NC} $*"; exit 1; }
warn() { echo -e "${YELLOW}!${NC} $*"; }

# 1) Validate docker-compose syntax
if command -v docker compose >/dev/null 2>&1; then
  docker compose -f docker-compose.ecosystem.yml config >/dev/null || fail "docker compose config failed"
  pass "docker compose config validated"
else
  warn "docker compose not available; skipping compose validation"
fi

# 2) Basic YAML sanity via yq if present
if command -v yq >/dev/null 2>&1; then
  yq '.' docker-compose.ecosystem.yml >/dev/null || fail "YAML parse failed"
  pass "YAML syntax valid via yq"
else
  warn "yq not found; skipping YAML structural validation"
fi

# 3) Lint shell scripts if shellcheck exists
if command -v shellcheck >/dev/null 2>&1; then
  shellcheck "$0" || fail "shellcheck failed on this hook"
  pass "shellcheck passed"
else
  warn "shellcheck not found; skipping shell lint"
fi

# 4) Policy: ensure secrets default placeholders are not production-insecure
if grep -q "change-me" docker-compose.ecosystem.yml; then
  warn "compose contains placeholder secrets; ensure CI overrides via env or secrets"
else
  pass "no placeholder secrets present"
fi

pass "MCP-native validation hook complete"
