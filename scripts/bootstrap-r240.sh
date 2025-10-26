#!/bin/bash
# Dell R240 Zero-Touch Bootstrap Script
# Usage: ./bootstrap-r240.sh [IP_ADDRESS]
# Requires: SSH access to Proxmox VE 9 host

set -euo pipefail

# Configuration
R240_IP="${1:-192.168.1.24}"
PROXMOX_USER="root"
PROXMOX_PASSWORD="${PROXMOX_PASSWORD:-}"  # Set in environment
HOMELAB_REPO="https://github.com/edcet/complete-homelab-orchestrator.git"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[WARNING] $1${NC}"
}

error() {
    echo -e "${RED}[ERROR] $1${NC}"
    exit 1
}

# Validation
if [[ -z "$PROXMOX_PASSWORD" ]]; then
    error "PROXMOX_PASSWORD environment variable must be set"
fi

if [[ -z "$TAILSCALE_AUTHKEY" ]]; then
    warn "TAILSCALE_AUTHKEY not set. Tailscale setup will be skipped."
fi

if [[ -z "$CLOUDFLARE_TOKEN" ]]; then
    warn "CLOUDFLARE_TOKEN not set. Cloudflare integration will be skipped."
fi

log "🚀 Starting Dell R240 homelab bootstrap"
log "Target: $R240_IP (Proxmox VE 9)"

# Test connectivity
log "🔍 Testing connectivity to $R240_IP..."
if ! ping -c 3 "$R240_IP" >/dev/null 2>&1; then
    error "Cannot reach $R240_IP. Check network connectivity."
fi

# Create SSH config for passwordless auth
log "🔐 Setting up SSH configuration..."
cat > ~/.ssh/config_r240 << EOF
Host r240
    HostName $R240_IP
    User $PROXMOX_USER
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
    PasswordAuthentication yes
EOF

# Install dependencies on Proxmox host
log "📦 Installing dependencies on Proxmox host..."
sshpass -p "$PROXMOX_PASSWORD" ssh -F ~/.ssh/config_r240 r240 << 'EOSSH'
set -e

# Update system
apt-get update
apt-get upgrade -y

# Install essential packages
apt-get install -y \
    curl \
    wget \
    git \
    htop \
    unzip \
    jq \
    python3-pip \
    nodejs \
    npm \
    docker.io \
    docker-compose \
    qemu-guest-agent

# Enable and start services
systemctl enable --now docker
systemctl enable --now qemu-guest-agent

# Install Node.js 20 (for homelab CLI)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install Pulumi
curl -fsSL https://get.pulumi.com | sh
export PATH=$PATH:$HOME/.pulumi/bin
echo 'export PATH=$PATH:$HOME/.pulumi/bin' >> ~/.bashrc

echo "✅ Dependencies installed successfully"
EOSSH

# Clone and setup homelab orchestrator
log "📁 Setting up homelab orchestrator..."
sshpass -p "$PROXMOX_PASSWORD" ssh -F ~/.ssh/config_r240 r240 << EOSSH
set -e

# Clone repository
if [ -d "/opt/homelab" ]; then
    rm -rf /opt/homelab
fi

git clone $HOMELAB_REPO /opt/homelab
cd /opt/homelab

# Install dependencies
npm ci
npm run build

# Create global symlink
ln -sf /opt/homelab/dist/bin/cli.js /usr/local/bin/homelab
chmod +x /usr/local/bin/homelab

# Copy production config
cp examples/production/r240-homelab.yaml /etc/homelab-config.yaml

echo "✅ Homelab orchestrator installed"
EOSSH

# Configure ZFS if not already done
log "💾 Configuring ZFS storage..."
sshpass -p "$PROXMOX_PASSWORD" ssh -F ~/.ssh/config_r240 r240 << 'EOSSH'
set -e

# Check if ZFS pool exists
if ! zpool list rpool >/dev/null 2>&1; then
    echo "⚠️  ZFS pool 'rpool' not found. You may need to configure storage manually."
    echo "Proxmox typically creates this during installation."
else
    echo "✅ ZFS pool 'rpool' exists"
    
    # Create additional datasets
    zfs create -o mountpoint=/rpool/data rpool/data 2>/dev/null || true
    zfs create -o mountpoint=/rpool/backups rpool/backups 2>/dev/null || true
    
    echo "✅ ZFS datasets configured"
fi
EOSSH

# Install Tailscale if authkey provided
if [[ -n "${TAILSCALE_AUTHKEY:-}" ]]; then
    log "🔗 Installing and configuring Tailscale..."
    sshpass -p "$PROXMOX_PASSWORD" ssh -F ~/.ssh/config_r240 r240 << EOSSH
set -e

# Install Tailscale
curl -fsSL https://tailscale.com/install.sh | sh

# Connect to tailnet
tailscale up --authkey="$TAILSCALE_AUTHKEY" \
    --hostname="r240-proxmox" \
    --advertise-tags="tag:homelab,tag:infrastructure,tag:proxmox" \
    --advertise-routes="192.168.1.0/24" \
    --accept-routes

echo "✅ Tailscale configured"
EOSSH
else
    warn "Skipping Tailscale setup (no authkey provided)"
fi

# Setup monitoring
log "📊 Setting up basic monitoring..."
sshpass -p "$PROXMOX_PASSWORD" ssh -F ~/.ssh/config_r240 r240 << 'EOSSH'
set -e

# Install node_exporter for Prometheus monitoring
wget https://github.com/prometheus/node_exporter/releases/latest/download/node_exporter-*linux-amd64.tar.gz
tar xzf node_exporter-*linux-amd64.tar.gz
mv node_exporter-*linux-amd64/node_exporter /usr/local/bin/
rm -rf node_exporter-*

# Create systemd service
cat > /etc/systemd/system/node_exporter.service << 'EOF'
[Unit]
Description=Node Exporter
Wants=network-online.target
After=network-online.target

[Service]
User=nobody
Group=nobody
Type=simple
ExecStart=/usr/local/bin/node_exporter --web.listen-address=:9100

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now node_exporter

echo "✅ Node exporter installed and running"
EOSSH

# Deploy initial configuration
log "🎯 Deploying homelab configuration..."
sshpass -p "$PROXMOX_PASSWORD" ssh -F ~/.ssh/config_r240 r240 << EOSSH
set -e

cd /opt/homelab

# Set environment variables
export PROXMOX_PASSWORD="$PROXMOX_PASSWORD"
${TAILSCALE_AUTHKEY:+export TAILSCALE_AUTHKEY="$TAILSCALE_AUTHKEY"}
${CLOUDFLARE_TOKEN:+export CLOUDFLARE_TOKEN="$CLOUDFLARE_TOKEN"}

# Validate configuration
echo "🔍 Validating homelab configuration..."
homelab validate -c /etc/homelab-config.yaml

# Run deployment preview
echo "👀 Running deployment preview..."
homelab deploy --preview -c /etc/homelab-config.yaml

echo "✅ Configuration validated and preview completed"
echo "🚀 Ready for full deployment with: homelab deploy -c /etc/homelab-config.yaml"
EOSSH

# Cleanup
rm -f ~/.ssh/config_r240

log "🎉 Dell R240 bootstrap completed successfully!"
log "📋 Next steps:"
echo -e "  ${BLUE}1.${NC} SSH to your Proxmox host: ssh root@$R240_IP"
echo -e "  ${BLUE}2.${NC} Review config: cat /etc/homelab-config.yaml"
echo -e "  ${BLUE}3.${NC} Deploy full stack: homelab deploy -c /etc/homelab-config.yaml"
echo -e "  ${BLUE}4.${NC} Check status: homelab status -c /etc/homelab-config.yaml"
echo -e "  ${BLUE}5.${NC} Access Proxmox: https://$R240_IP:8006"

if [[ -n "${TAILSCALE_AUTHKEY:-}" ]]; then
    echo -e "  ${BLUE}6.${NC} Check Tailscale: tailscale status"
fi

log "🔧 Homelab orchestrator available at: /opt/homelab"
log "📖 Documentation: https://github.com/edcet/complete-homelab-orchestrator"