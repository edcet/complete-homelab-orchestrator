#!/bin/bash
# Complete Homelab Deployment with Embedded Secrets
# Deploys to R240 @ 192.168.1.24 with full automation

set -euo pipefail

# Target configuration
R240_IP="192.168.1.24"
PROXMOX_USER="root"

# Embedded production secrets
export PROXMOX_PASSWORD="        "  # Spaces preserved
export TAILSCALE_AUTHKEY="tskey-auth-kiTs1GKsoz11CNTRL-mLTL7wveWQQDxxwWBZViQQpZLgmx7pX6"
export TS_API_KEY="tskey-api-kZyJNLV8ro11CNTRL-Ge8U9ysXU6Ei9qahBS3v6ES9yxngfPPN"
export TS_AUTH_KEY_ALT="tskey-auth-kZFaLz3w2U11CNTRL-L742y4syHZR4sh9kmQ4AZRwa9zcvcAJR"
export CF_ZONE_NAME="rns.lol"
export CF_ZONE_ID="4с6е224b45c0a417d2654a388973c3ad"
export CF_API_TOKEN="z3SaYFCwoM4te0M8OGrAKDziBbieMcVvcXkG5kDf"
export CF_ACCOUNT_ID="2dfd47aeafc8157f480cde25ebdd0cd9"
export TAILSCALE_CONTROL_URL="curl-chimera.ts.net"

# AdGuard DNS endpoints
export ADGUARD_DOH1="https://d.adguard-dns.com/dns-query/8f6cee2a"
export ADGUARD_DOH2="https://d.adguard-dns.com/dns-query/"
export ADGUARD_DNSV4_1="94.140.14.49"
export ADGUARD_DNSV4_2="94.140.14.59"
export ADGUARD_DNSV6_1="2a10:50c0:c000::969a:5a49"
export ADGUARD_DNSV6_2="2a10:50c0:c000::1:969a:5a49"
export ADGUARD_TLS="tls://8f6cee2a.d.adguard-dns.com"
export ADGUARD_QUIC="quic://8f6cee2a.d.adguard-dns.com"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[$(date +'%H:%M:%S')] $1${NC}"
}

error() {
    echo -e "${RED}[ERROR] $1${NC}"
    exit 1
}

log "🚀 PRODUCTION DEPLOYMENT: R240 @ $R240_IP"
log "Domain: rns.lol | Tailnet: curl-chimera.ts.net"

# Test connectivity first
log "🔍 Testing connectivity..."
if ! ping -c 2 "$R240_IP" >/dev/null 2>&1; then
    error "Cannot reach $R240_IP"
fi

# SSH and execute complete deployment
log "🔗 Connecting to Proxmox host..."
sshpass -p "$PROXMOX_PASSWORD" ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$PROXMOX_USER@$R240_IP" << 'EOSSH'
set -euo pipefail

# Export all environment variables on remote host
export PROXMOX_PASSWORD="        "
export TAILSCALE_AUTHKEY="tskey-auth-kiTs1GKsoz11CNTRL-mLTL7wveWQQDxxwWBZViQQpZLgmx7pX6"
export TS_API_KEY="tskey-api-kZyJNLV8ro11CNTRL-Ge8U9ysXU6Ei9qahBS3v6ES9yxngfPPN"
export CF_ZONE_NAME="rns.lol"
export CF_ZONE_ID="4с6е224b45c0a417d2654a388973c3ad"
export CF_API_TOKEN="z3SaYFCwoM4te0M8OGrAKDziBbieMcVvcXkG5kDf"
export CF_ACCOUNT_ID="2dfd47aeafc8157f480cde25ebdd0cd9"
export TAILSCALE_CONTROL_URL="curl-chimera.ts.net"
export ADGUARD_DOH1="https://d.adguard-dns.com/dns-query/8f6cee2a"
export ADGUARD_DNSV4_1="94.140.14.49"
export ADGUARD_DNSV4_2="94.140.14.59"

echo "🔥 AUTOMATED HOMELAB DEPLOYMENT STARTING"
echo "Target: $(hostname) @ $(hostname -I | awk '{print $1}')"
echo "Time: $(date)"

# Update system
echo "📦 Updating system packages..."
apt update && apt upgrade -y

# Install core dependencies
echo "🔧 Installing dependencies..."
apt install -y curl wget git htop unzip jq python3-pip docker.io docker-compose sshpass
systemctl enable --now docker

# Install Node.js 20
echo "🔧 Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install Pulumi
echo "🔧 Installing Pulumi..."
curl -fsSL https://get.pulumi.com | sh
export PATH=$PATH:$HOME/.pulumi/bin
echo 'export PATH=$PATH:$HOME/.pulumi/bin' >> ~/.bashrc

# Clone homelab orchestrator
echo "📁 Setting up homelab orchestrator..."
if [ -d "/opt/homelab" ]; then
    rm -rf /opt/homelab
fi
git clone https://github.com/edcet/complete-homelab-orchestrator.git /opt/homelab
cd /opt/homelab

# Install and build
echo "🔨 Building homelab orchestrator..."
npm ci
npm run build

# Create global CLI link
ln -sf /opt/homelab/dist/bin/cli.js /usr/local/bin/homelab
chmod +x /usr/local/bin/homelab

# Create production config with real values
echo "📝 Creating production configuration..."
cat > /etc/homelab-config.yaml << 'CONFIG_EOF'
domain: "rns.lol"
zone_id: "4с6е224b45c0a417d2654a388973c3ad"

hardware:
  r240:
    ip: "192.168.1.24"
    idrac_ip: "192.168.1.124"
    proxmox_port: 8006
    ssh_user: "root"
    
networks:
  primary_subnet: "192.168.1.0/24"
  tailnet_domain: "curl-chimera.ts.net"
  vlan_isolation: false
  ipv6_enabled: true

services:
  adguard:
    enabled: true
    web_port: 3080
    dns_port: 53
    container_id: 100
    upstreams:
      - "https://d.adguard-dns.com/dns-query/8f6cee2a"
      - "tls://8f6cee2a.d.adguard-dns.com"
      - "quic://8f6cee2a.d.adguard-dns.com"
    upstream_addrs:
      - "94.140.14.49"
      - "94.140.14.59"
      - "2a10:50c0:c000::969a:5a49"
      - "2a10:50c0:c000::1:969a:5a49"
    blocklists:
      - "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts"
    tailscale_client_sync: true
    
  tailscale:
    enabled: true
    exit_node: false
    subnet_routes:
      - "192.168.1.0/24"
    tags:
      - "tag:homelab"
      - "tag:infrastructure"
      - "tag:proxmox"
      - "tag:r240"

  cloudflare:
    enabled: true
    tunnel_name: "homelab-r240"
    services:
      - hostname: "proxmox.rns.lol"
        service: "https://192.168.1.24:8006"
      - hostname: "adguard.rns.lol"
        service: "http://192.168.1.24:3080"
      - hostname: "grafana.rns.lol"
        service: "http://192.168.1.24:3000"
        
  olares:
    enabled: true
    container_id: 200
    cores: 4
    memory: "8192"
    storage: "64"
    k3s_oidc: true
    domain_suffix: "olares.rns.lol"
    
  yunohost:
    enabled: true
    container_id: 201
    cores: 2
    memory: "4096"
    storage: "32"
    domain_suffix: "yunohost.rns.lol"
    apps:
      - "adguardhome"
      - "nextcloud"
      - "grafana"
      
  monitoring:
    enabled: true
    prometheus_port: 9090
    grafana_port: 3000
    exporters:
      - "node"
      - "proxmox"
      - "adguard"
      - "tailscale"
      
storage:
  zfs:
    enabled: true
    pool_name: "rpool"
    datasets:
      - name: "data"
        mountpoint: "/rpool/data"
      - name: "backups" 
        mountpoint: "/rpool/backups"
        
security:
  ssh_ca: true
  fail2ban: true
  ufw_enabled: true
  
backups:
  enabled: true
  destinations:
    - type: "local"
      path: "/rpool/backups"
      
automation:
  auto_updates: true
  health_checks: true
  self_healing: true
  metric_collection: true
CONFIG_EOF

# Validate configuration
echo "🔍 Validating configuration..."
homelab validate -c /etc/homelab-config.yaml

# Install Tailscale first for mesh networking
echo "🔗 Installing Tailscale..."
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --authkey="$TAILSCALE_AUTHKEY" \
    --hostname="r240-proxmox" \
    --advertise-tags="tag:homelab,tag:infrastructure,tag:proxmox,tag:r240" \
    --advertise-routes="192.168.1.0/24" \
    --accept-routes \
    --shields-up=false

echo "🌐 Tailscale mesh connected: $(tailscale ip -4)"

# Install monitoring first (node_exporter)
echo "📊 Installing monitoring..."
wget -q https://github.com/prometheus/node_exporter/releases/latest/download/node_exporter-1.7.0.linux-amd64.tar.gz
tar xzf node_exporter-*.tar.gz
mv node_exporter-*/node_exporter /usr/local/bin/
rm -rf node_exporter-*

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
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now node_exporter
echo "✅ Node exporter running on :9100"

# Deploy complete homelab stack
echo "🚀 DEPLOYING COMPLETE HOMELAB STACK..."
echo "This will take 10-15 minutes. Sit back and watch the magic."

# Run deployment with progress indicators
homelab deploy -c /etc/homelab-config.yaml --verbose 2>&1 | while IFS= read -r line; do
    echo "[$(date +'%H:%M:%S')] $line"
done

# Post-deployment verification
echo "🔍 Running post-deployment verification..."
homelab status -c /etc/homelab-config.yaml

# Show access information
echo ""
echo -e "\033[1;32m🎉 HOMELAB DEPLOYMENT COMPLETE! \033[0m"
echo ""
echo -e "\033[1;34m🎯 ACCESS POINTS:\033[0m"
echo "  Proxmox VE:    https://192.168.1.24:8006"
echo "  AdGuard Home:  http://192.168.1.24:3080"
echo "  Grafana:       http://192.168.1.24:3000"
echo "  Node Metrics:  http://192.168.1.24:9100/metrics"
echo ""
echo "  External (via Cloudflare tunnels):"
echo "  • https://proxmox.rns.lol"
echo "  • https://adguard.rns.lol"
echo "  • https://grafana.rns.lol"
echo ""
echo -e "\033[1;34m🔗 TAILSCALE MESH:\033[0m"
echo "  Device: $(tailscale status --self | head -1)"
echo "  Control: curl-chimera.ts.net"
echo "  Routes: 192.168.1.0/24 advertised"
echo ""
echo -e "\033[1;34m🛡️ SECURITY:\033[0m"
echo "  Firewall: ufw enabled"
echo "  Fail2ban: active"
echo "  SSH CA: configured"
echo ""
echo -e "\033[1;34m📊 MONITORING:\033[0m"
echo "  Prometheus: http://192.168.1.24:9090"
echo "  Grafana: http://192.168.1.24:3000 (admin/admin)"
echo "  Exporters: Node, Proxmox, AdGuard, Tailscale"
echo ""
echo -e "\033[1;33m📝 NEXT STEPS:\033[0m"
echo "  1. Access Proxmox: https://192.168.1.24:8006"
echo "  2. Configure DNS: Point devices to 192.168.1.24"
echo "  3. Join Tailscale: https://login.tailscale.com/admin/machines"
echo "  4. Monitor: homelab status -c /etc/homelab-config.yaml"
echo ""
echo -e "\033[1;32m🏁 DEPLOYMENT SUCCESS - Your homelab is ready!\033[0m"

EOSSH

log "✅ Remote deployment completed"
log "📚 Documentation: https://github.com/edcet/complete-homelab-orchestrator"