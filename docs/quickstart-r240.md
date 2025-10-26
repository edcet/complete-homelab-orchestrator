# Dell R240 Homelab Quickstart

> 🚀 **Zero-touch deployment from fresh Proxmox VE 9 to complete homelab in 15 minutes**

## Prerequisites

- Dell R240 with Proxmox VE 9 installed
- Network access to Proxmox host (SSH on port 22)
- Root password for Proxmox
- (Optional) Tailscale account for mesh networking
- (Optional) Cloudflare account for DNS/tunnels

## Quick Start

### 1. Clone Repository
```bash
git clone https://github.com/edcet/complete-homelab-orchestrator.git
cd complete-homelab-orchestrator
```

### 2. Set Environment Variables
```bash
# Required
export PROXMOX_PASSWORD="        "  # Your Proxmox root password

# Optional but recommended
export TAILSCALE_AUTHKEY="tskey-auth-..."  # From https://login.tailscale.com/admin/settings/keys
export CLOUDFLARE_TOKEN="..."              # From Cloudflare API tokens
```

### 3. Bootstrap R240
```bash
# Bootstrap with auto-detected IP
./scripts/bootstrap-r240.sh

# Or specify IP manually
./scripts/bootstrap-r240.sh 192.168.1.24
```

### 4. Deploy Homelab
```bash
# SSH to Proxmox host
ssh root@192.168.1.24

# Deploy complete homelab stack
homelab deploy -c /etc/homelab-config.yaml
```

### 5. Verify Deployment
```bash
# Check status
homelab status -c /etc/homelab-config.yaml

# Access services
# - Proxmox: https://192.168.1.24:8006
# - AdGuard: http://192.168.1.24:3080
# - Monitoring: http://192.168.1.24:3000
```

## What Gets Deployed

### Core Infrastructure
- **Proxmox VE 9**: Virtualization platform
- **ZFS Storage**: High-performance, resilient storage
- **Tailscale**: Mesh VPN for secure remote access
- **AdGuard Home**: Network-wide ad blocking and DNS

### Platform Services
- **Olares**: Modern cloud OS with K3s (LXC container)
- **YunoHost**: Self-hosting platform (LXC container)
- **Monitoring**: Prometheus + Grafana + Node Exporter
- **Cloudflared**: Secure tunnels for external access

### Automation Features
- **Health Monitoring**: Continuous service health checks
- **Auto-Updates**: Automated security updates
- **Backup System**: Automated backups to local and cloud storage
- **Self-Healing**: Automatic service recovery

## Configuration Customization

### Edit Configuration
```bash
# On Proxmox host
nano /etc/homelab-config.yaml
```

### Key Settings to Customize

```yaml
# Change to your domain
domain: "yourdomain.com"
zone_id: "your-cloudflare-zone-id"

# Adjust resource allocation
services:
  olares:
    cores: 4        # CPU cores
    memory: "8192"   # RAM in MB
    storage: "64"    # Disk in GB
    
  yunohost:
    cores: 2
    memory: "4096"
    storage: "32"
```

## Troubleshooting

### Common Issues

**Bootstrap fails with SSH connection error:**
```bash
# Check network connectivity
ping 192.168.1.24

# Verify SSH service
nmap -p 22 192.168.1.24
```

**Deployment fails with resource error:**
```bash
# Check available resources
pvesh get /nodes/$(hostname)/status

# Adjust memory/CPU in config
nano /etc/homelab-config.yaml
```

**Services not accessible:**
```bash
# Check service status
homelab status -c /etc/homelab-config.yaml

# Check container status
pct list
qm list
```

### Getting Help

- **Logs**: `tail -f /var/log/homelab-deploy.log`
- **Status**: `homelab status -c /etc/homelab-config.yaml`
- **GitHub Issues**: https://github.com/edcet/complete-homelab-orchestrator/issues

## Advanced Features

### Enable Additional Services
```bash
# Enable more monitoring exporters
homelab exporters enable --all

# Setup additional YunoHost apps
homelab yunohost install-app nextcloud
homelab yunohost install-app jellyfin

# Configure additional Tailscale routes
homelab tailscale advertise-routes 10.0.0.0/24
```

### Backup and Recovery
```bash
# Manual backup
homelab backup create --all

# Restore from backup
homelab backup restore --from /rpool/backups/latest

# Setup cloud backup
homelab backup configure s3 --bucket homelab-backups
```

### Monitoring and Alerting
```bash
# Setup alerts
homelab monitoring setup-alerts --webhook https://hooks.slack.com/...

# View metrics
homelab monitoring dashboard

# Export metrics
homelab monitoring export --format prometheus
```

## Production Considerations

### Security Hardening
1. Change default passwords immediately
2. Enable SSH key authentication
3. Configure firewall rules
4. Setup certificate authority
5. Enable audit logging

### Performance Optimization
1. Adjust ZFS ARC size for your RAM
2. Configure CPU governor for performance
3. Enable KSM (Kernel Same-page Merging)
4. Optimize network settings

### Maintenance
1. Setup automated backups
2. Configure update schedules
3. Monitor resource usage
4. Plan capacity expansion

---

**🎯 Result**: Complete homelab infrastructure deployed and ready for production use in ~15 minutes.

**📚 Next**: Explore the [full configuration guide](./configuration.md) for advanced customization options.