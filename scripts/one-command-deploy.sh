#!/bin/bash
# ONE COMMAND HOMELAB DEPLOYMENT
# Usage: curl -sSL https://raw.githubusercontent.com/edcet/complete-homelab-orchestrator/main/scripts/one-command-deploy.sh | bash

set -euo pipefail

R240_IP="192.168.1.24"
PROXMOX_PASSWORD="        "
TAILSCALE_AUTHKEY="tskey-auth-kiTs1GKsoz11CNTRL-mLTL7wveWQQDxxwWBZViQQpZLgmx7pX6"

echo "🚀 ONE-COMMAND HOMELAB DEPLOYMENT STARTING..."
echo "Target: Dell R240 @ $R240_IP"
echo "Domain: rns.lol"
echo "Time: $(date)"
echo ""

# Test connectivity
if ! ping -c 2 "$R240_IP" >/dev/null 2>&1; then
    echo "❌ Cannot reach $R240_IP. Check network connection."
    exit 1
fi

echo "✅ Connectivity verified"

# Install local dependencies if needed
if ! command -v sshpass >/dev/null 2>&1; then
    echo "📦 Installing sshpass..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install hudochenkov/sshpass/sshpass
    else
        sudo apt-get update && sudo apt-get install -y sshpass
    fi
fi

echo "🔗 Connecting to Proxmox host for complete deployment..."
echo "This will install and configure your entire homelab. ETA: 15 minutes."
echo ""

# Execute complete deployment on Proxmox host
sshpass -p "$PROXMOX_PASSWORD" ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "root@$R240_IP" << 'COMPLETE_DEPLOY'
set -euo pipefail

# Set all secrets
export PROXMOX_PASSWORD="        "
export TAILSCALE_AUTHKEY="tskey-auth-kiTs1GKsoz11CNTRL-mLTL7wveWQQDxxwWBZViQQpZLgmx7pX6"
export TS_API_KEY="tskey-api-kZyJNLV8ro11CNTRL-Ge8U9ysXU6Ei9qahBS3v6ES9yxngfPPN" 
export CF_ZONE_ID="4с6е224b45c0a417d2654a388973c3ad"
export CF_API_TOKEN="z3SaYFCwoM4te0M8OGrAKDziBbieMcVvcXkG5kDf"
export CF_ACCOUNT_ID="2dfd47aeafc8157f480cde25ebdd0cd9"

echo "📁 STEP 1/7: System preparation"
apt update >/dev/null 2>&1
apt install -y curl wget git htop docker.io docker-compose sshpass jq >/dev/null 2>&1
systemctl enable --now docker >/dev/null 2>&1

echo "🔧 STEP 2/7: Installing Node.js and Pulumi"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
apt install -y nodejs >/dev/null 2>&1
curl -fsSL https://get.pulumi.com | sh >/dev/null 2>&1
export PATH=$PATH:$HOME/.pulumi/bin

echo "📁 STEP 3/7: Cloning homelab orchestrator"
rm -rf /opt/homelab 2>/dev/null || true
git clone https://github.com/edcet/complete-homelab-orchestrator.git /opt/homelab >/dev/null 2>&1
cd /opt/homelab
npm ci >/dev/null 2>&1
npm run build >/dev/null 2>&1
ln -sf /opt/homelab/dist/bin/cli.js /usr/local/bin/homelab

echo "🔗 STEP 4/7: Configuring Tailscale mesh"
curl -fsSL https://tailscale.com/install.sh | sh >/dev/null 2>&1
tailscale up --authkey="$TAILSCALE_AUTHKEY" --hostname="r240-proxmox" --advertise-tags="tag:homelab,tag:infrastructure,tag:proxmox" --advertise-routes="192.168.1.0/24" --accept-routes >/dev/null 2>&1

echo "📊 STEP 5/7: Installing monitoring"
wget -q https://github.com/prometheus/node_exporter/releases/latest/download/node_exporter-1.7.0.linux-amd64.tar.gz
tar xzf node_exporter-*.tar.gz >/dev/null 2>&1
mv node_exporter-*/node_exporter /usr/local/bin/
rm -rf node_exporter-*

cat > /etc/systemd/system/node_exporter.service << 'EOF'
[Unit]
Description=Node Exporter
[Service]
User=nobody
ExecStart=/usr/local/bin/node_exporter --web.listen-address=:9100
Restart=always
[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload >/dev/null 2>&1
systemctl enable --now node_exporter >/dev/null 2>&1

echo "📝 STEP 6/7: Creating production config"
cp examples/production/rns-lol-config.yaml /etc/homelab-config.yaml

echo "🚀 STEP 7/7: Deploying complete homelab stack"
echo "This is the main deployment. Progress will be shown..."
echo ""

homelab validate -c /etc/homelab-config.yaml
homelab deploy -c /etc/homelab-config.yaml

echo ""
echo "🎉 DEPLOYMENT COMPLETE!"
echo ""
echo "Access your homelab:"
echo "  • Proxmox VE: https://192.168.1.24:8006"
echo "  • AdGuard Home: http://192.168.1.24:3080"
echo "  • Grafana: http://192.168.1.24:3000"
echo "  • Prometheus: http://192.168.1.24:9090"
echo "  • External via Cloudflare: https://proxmox.rns.lol"
echo ""
echo "Tailscale mesh: $(tailscale status --self | head -1)"
echo ""
echo "Status check: homelab status -c /etc/homelab-config.yaml"
echo ""
echo "🏁 Your zero-touch homelab is ready!"

COMPLETE_DEPLOY

echo ""
echo "🎆 ONE-COMMAND DEPLOYMENT COMPLETE!"
echo "Your homelab at https://proxmox.rns.lol is now fully operational."
echo "📊 Status: ssh root@$R240_IP 'homelab status'"
echo "📖 Docs: https://github.com/edcet/complete-homelab-orchestrator"