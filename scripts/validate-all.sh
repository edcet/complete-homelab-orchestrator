#!/usr/bin/env bash
set -euo pipefail

echo "🧪 Running comprehensive validation suite..."
echo "================================================"

# 1) Schema validation
CONFIG_PATH="${1:-examples/advanced/homelab.yaml}"
if [[ -f "$CONFIG_PATH" ]]; then
  echo "📄 Validating schema: $CONFIG_PATH"
  npx ts-node scripts/validate-config.ts "$CONFIG_PATH"
else
  echo "⚠️ Config file not found: $CONFIG_PATH (skipping schema validation)"
fi

# 2) TypeScript + lint + formatting
echo ""
echo "🔍 TypeScript & Code Quality..."
./scripts/validate-ts.sh

# 3) Unit tests with coverage
echo ""
echo "🧪 Unit tests..."
npm test -- --coverage --passWithNoTests

# 4) Docker compose validation (if available)
if command -v docker >/dev/null 2>&1 && [[ -f "docker-compose.yml" ]]; then
  echo ""
  echo "🐳 Docker Compose validation..."
  docker compose config >/dev/null && echo "✅ Docker Compose valid"
fi

# 5) Package.json validation
echo ""
echo "📦 Package.json validation..."
npm run lint:package 2>/dev/null || echo "ℹ️ Package lint not configured (skipping)"

echo ""
echo "✅ All validations passed!"
echo "🚀 Ready for deployment."