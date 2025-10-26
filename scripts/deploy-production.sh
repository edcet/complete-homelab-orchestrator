#!/bin/bash
# Production Deployment Script for R240 Homelab
# Run from Proxmox host after bootstrap

set -euo pipefail

# Configuration
CONFIG_FILE="/etc/homelab-config.yaml"
LOG_FILE="/var/log/homelab-deploy.log"
BACKUP_DIR="/rpool/backups/pre-deploy-$(date +%Y%m%d-%H%M%S)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    local msg="[$(date +'%Y-%m-%d %H:%M:%S')] $1"
    echo -e "${GREEN}$msg${NC}"
    echo "$msg" >> "$LOG_FILE"
}

warn() {
    local msg="[WARNING] $1"
    echo -e "${YELLOW}$msg${NC}"
    echo "$msg" >> "$LOG_FILE"
}

error() {
    local msg="[ERROR] $1"
    echo -e "${RED}$msg${NC}"
    echo "$msg" >> "$LOG_FILE"
    exit 1
}

# Pre-deployment checks
log "🔍 Running pre-deployment checks..."

# Check if running on Proxmox
if ! command -v pveversion >/dev/null 2>&1; then
    error "This script must be run on a Proxmox VE host"
fi

# Check if homelab CLI is available
if ! command -v homelab >/dev/null 2>&1; then
    error "Homelab CLI not found. Run bootstrap-r240.sh first."
fi

# Check configuration exists
if [[ ! -f "$CONFIG_FILE" ]]; then
    error "Configuration file not found: $CONFIG_FILE"
fi

# Validate environment variables
required_vars=("PROXMOX_PASSWORD")
optional_vars=("TAILSCALE_AUTHKEY" "CLOUDFLARE_TOKEN")

for var in "${required_vars[@]}"; do
    if [[ -z "${!var:-}" ]]; then
        error "Required environment variable $var is not set"
    fi
done

for var in "${optional_vars[@]}"; do
    if [[ -z "${!var:-}" ]]; then
        warn "Optional environment variable $var is not set. Some features may be disabled."
    fi
done

# Create backup directory
log "💾 Creating pre-deployment backup..."
mkdir -p "$BACKUP_DIR"

# Backup current VM/CT configurations
pvesh get /cluster/resources --type vm --output-format json > "$BACKUP_DIR/vms-backup.json"
pvesh get /cluster/resources --type storage --output-format json > "$BACKUP_DIR/storage-backup.json"

# Backup network configuration
cp /etc/network/interfaces "$BACKUP_DIR/interfaces.backup" 2>/dev/null || true
cp /etc/hosts "$BACKUP_DIR/hosts.backup"

# Backup current configuration
cp "$CONFIG_FILE" "$BACKUP_DIR/homelab-config.yaml.backup"

log "✅ Backup created at: $BACKUP_DIR"

# Validate configuration
log "🔍 Validating homelab configuration..."
if ! homelab validate -c "$CONFIG_FILE"; then
    error "Configuration validation failed. Check $CONFIG_FILE"
fi

# Show deployment preview
log "👀 Generating deployment preview..."
homelab deploy --preview -c "$CONFIG_FILE" | tee "$BACKUP_DIR/deployment-preview.txt"

# Confirmation prompt
echo -e "\n${YELLOW}📋 Deployment Summary:${NC}"
echo -e "  Config: $CONFIG_FILE"
echo -e "  Backup: $BACKUP_DIR"
echo -e "  Log: $LOG_FILE"

read -p "Proceed with deployment? [y/N]: " -n 1 -r
echo

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    log "❌ Deployment cancelled by user"
    exit 0
fi

# Execute deployment
log "🚀 Starting homelab deployment..."
start_time=$(date +%s)

if homelab deploy -c "$CONFIG_FILE" --verbose 2>&1 | tee -a "$LOG_FILE"; then
    end_time=$(date +%s)
    duration=$((end_time - start_time))
    
    log "🎉 Deployment completed successfully!"
    log "⏱️  Total time: ${duration}s"
    
    # Post-deployment status check
    log "📊 Running post-deployment status check..."
    homelab status -c "$CONFIG_FILE" | tee "$BACKUP_DIR/post-deploy-status.txt"
    
    # Display access information
    echo -e "\n${GREEN}🎯 Homelab Services:${NC}"
    echo -e "  Proxmox VE: https://$(hostname -I | awk '{print $1}'):8006"
    echo -e "  AdGuard Home: http://$(hostname -I | awk '{print $1}'):3080"
    
    if [[ -n "${TAILSCALE_AUTHKEY:-}" ]]; then
        echo -e "  Tailscale Status: $(tailscale status --self | head -1)"
    fi
    
    echo -e "\n${GREEN}📚 Next Steps:${NC}"
    echo -e "  • Configure your DNS to use AdGuard: $(hostname -I | awk '{print $1}')"
    echo -e "  • Access services via Tailscale mesh network"
    echo -e "  • Monitor with: homelab status -c $CONFIG_FILE"
    echo -e "  • View logs: tail -f $LOG_FILE"
    
else
    error "Deployment failed. Check logs at $LOG_FILE"
fi

log "🏁 Production deployment script completed"