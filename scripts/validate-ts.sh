#!/usr/bin/env bash
set -euo pipefail

echo "🔍 TypeScript type check..."
npx tsc --noEmit --skipLibCheck

echo "🧹 ESLint..."
npx eslint 'src/**/*.{ts,tsx}' --max-warnings 0

echo "✨ Prettier check..."
npx prettier --check 'src/**/*.{ts,tsx,md,yaml,yml,json}' '*.{md,json}'

echo "✅ All TypeScript validations passed!"