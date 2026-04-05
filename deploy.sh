#!/usr/bin/env bash
# Briefly — One-command Cloudflare deployment script
# Usage: CLOUDFLARE_API_TOKEN=<token> bash deploy.sh
# Or: bash deploy.sh (if already logged in via `wrangler login`)

set -euo pipefail

ACCOUNT_ID="693ae9c587f1f2c34328bb47447366b0"
export CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID"

echo "🚀 Deploying Briefly to Cloudflare Workers..."
echo "   Account: $ACCOUNT_ID"
echo ""

# 1. Install dependencies if not present
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  npm install --legacy-peer-deps
fi

# 2. Create KV namespace for A2A tasks
echo "🗄️  Creating KV namespace A2A_TASKS..."
KV_OUTPUT=$(npx wrangler kv namespace create A2A_TASKS 2>&1 || true)
KV_ID=$(echo "$KV_OUTPUT" | grep -o '"id": "[^"]*"' | head -1 | cut -d'"' -f4)

# If namespace already exists, list and find it
if [ -z "$KV_ID" ]; then
  echo "   KV namespace may already exist, looking up ID..."
  KV_ID=$(npx wrangler kv namespace list 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for ns in data:
        if ns.get('title') in ('briefly-A2A_TASKS', 'A2A_TASKS'):
            print(ns['id'])
            break
except: pass
" 2>/dev/null || echo "")
fi

if [ -n "$KV_ID" ]; then
  echo "   ✅ KV namespace ID: $KV_ID"
  # Update wrangler.toml in place (safe — uses temp file)
  sed -i.bak "s/REPLACE_WITH_KV_NAMESPACE_ID/$KV_ID/" wrangler.toml && rm -f wrangler.toml.bak
  echo "   ✅ Updated wrangler.toml"
else
  echo "   ⚠️  Could not determine KV namespace ID. You may need to update wrangler.toml manually."
  echo "   Run: wrangler kv namespace list"
fi

# 3. Deploy
echo ""
echo "☁️  Deploying worker..."
npx wrangler deploy --minify

echo ""
echo "✅ Briefly is live!"
echo ""
echo "   🌐  App:         https://briefly.workers.dev"
echo "   💬  Chat API:    https://briefly.workers.dev/agents/briefly/global"
echo "   📡  MCP server:  https://briefly.workers.dev/mcp"
echo "   🤖  A2A card:    https://briefly.workers.dev/.well-known/agent-card.json"
echo "   📊  Feed API:    https://briefly.workers.dev/api/feed"
echo ""
echo "   Connect Claude Desktop to the MCP server:"
echo "   Add to claude_desktop_config.json:"
echo '   { "mcpServers": { "briefly": { "url": "https://briefly.workers.dev/mcp" } } }'
