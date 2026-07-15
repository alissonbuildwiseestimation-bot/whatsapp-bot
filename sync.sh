#!/bin/bash
echo "🔄 Starting synchronization with aadil12347/whatsapp-bot..."

# 1. Stash any uncommitted local changes in Codespace
echo "📦 Stashing local changes..."
git stash

# 2. Pull latest changes from the public fork with rebase
echo "📥 Pulling latest code from aadil12347/whatsapp-bot..."
if git pull https://github.com/aadil12347/whatsapp-bot.git main --rebase; then
    # 3. Force-push to Codespace remote (origin)
    echo "📤 Force-pushing updates to origin main..."
    git push origin main --force
    echo "✅ Synchronization complete!"
else
    echo "❌ Git pull failed. Please resolve conflicts."
fi

# 4. Re-apply stashed changes
echo "📦 Restoring local changes from stash..."
git stash pop 2>/dev/null || true
