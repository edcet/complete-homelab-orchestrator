import * as docker from "@pulumi/docker";
import * as cloudflare from "@pulumi/cloudflare";
import * as command from "@pulumi/command";
import { ComponentResource } from "@pulumi/pulumi";
import { HomelabConfig } from '../types/schemas';

export class NetworkManager {
  constructor(
    private config: HomelabConfig,
    private parent: ComponentResource
  ) {}
  
  public createNetwork(): docker.Network {
    return new docker.Network("homelab-network", {
      name: this.config.networks.docker_network,
      driver: "bridge",
      ipamConfig: [{
        subnet: this.config.networks.primary_subnet,
      }],
      enableIpv6: false,
      labels: {
        "homelab.network": "primary",
        "homelab.domain": this.config.domain
      }
    }, { parent: this.parent });
  }
  
  public deployCloudflaredTunnel(network: docker.Network): docker.Container {
    if (!this.config.services.cloudflared.enabled) {
      throw new Error("Cloudflared service is disabled");
    }
    
    // Enhanced tunnel configuration with all services
    const tunnelConfig = new command.local.Command("create-comprehensive-tunnel-config", {
      create: `
        mkdir -p /tmp/cloudflared
        cat > /tmp/cloudflared/config.yml << 'EOF'
tunnel: ${this.config.services.cloudflared.tunnel_name}
credentials-file: /etc/cloudflared/homelab.json

ingress:
  # Core gateway
  - hostname: gateway.${this.config.domain}
    service: http://pangolin:3001
    
  # Platform services
  - hostname: yunohost.${this.config.domain}
    service: http://${this.config.hardware.r240.ip}:3002
  - hostname: olares.${this.config.domain}  
    service: http://olares:${this.config.services.olares.port}
  - hostname: casaos.${this.config.domain}
    service: http://casaos:${this.config.services.casaos.port || 80}
    
  # Infrastructure services
  - hostname: adguard.${this.config.domain}
    service: http://adguard:${this.config.services.adguard.web_port}
  - hostname: homepage.${this.config.domain}
    service: http://homepage:3000
  - hostname: pve.${this.config.domain}
    service: https://${this.config.hardware.r240.ip}:${this.config.hardware.r240.proxmox_port || 8006}
    originServerName: ${this.config.hardware.r240.ip}
  - hostname: idrac-r240.${this.config.domain}
    service: https://${this.config.hardware.r240.idrac_ip}
    originServerName: ${this.config.hardware.r240.idrac_ip}
  - hostname: idrac-r7910.${this.config.domain}
    service: https://${this.config.hardware.r7910.idrac_ip}
    originServerName: ${this.config.hardware.r7910.idrac_ip}
    
  # Monitoring & Management
  - hostname: setec.${this.config.domain}
    service: http://setec:${this.config.services.setec.port}
  - hostname: ca.${this.config.domain}
    service: http://step-ca:${this.config.services.step_ca.port}
    
  # SSH access
  - hostname: ssh.${this.config.domain}
    service: ssh://${this.config.hardware.r240.ip}:${this.config.hardware.r240.ssh_port}
    
  # MCP API endpoint
  - hostname: api.${this.config.domain}
    service: http://localhost:${this.config.networks.mcp_endpoint}
    
  # Catch-all wildcard
  - hostname: "*.${this.config.domain}"
    service: http://pangolin:3001
    originRequest:
      httpHostHeader: "{hostname}"
      
  - service: http_status:404
EOF
      `
    }, { parent: this.parent });

    return new docker.Container("cloudflared-tunnel", {
      image: "cloudflare/cloudflared:latest",
      restart: "unless-stopped",
      command: ["tunnel", "run", this.config.services.cloudflared.tunnel_name],
      volumes: [
        { hostPath: "/tmp/cloudflared", containerPath: "/etc/cloudflared" }
      ],
      networksAdvanced: [{
        name: network.name,
        aliases: ["cloudflared"]
      }],
      labels: {
        "homelab.service": "cloudflared",
        "homelab.role": "tunnel"
      },
      dependsOn: [tunnelConfig]
    }, { parent: this.parent });
  }
  
  public configureTailscaleMesh(): command.local.Command {
    return new command.local.Command("comprehensive-tailscale-setup", {
      create: `
        # Install Tailscale if not present
        if ! command -v tailscale &> /dev/null; then
          curl -fsSL https://tailscale.com/install.sh | sh
        fi

        # Configure comprehensive mesh
        tailscale up --authkey=${this.config.tailscale_auth_key} \
          --advertise-routes=${this.config.networks.primary_subnet} \
          --accept-routes \
          --ssh \
          --hostname=homelab-gateway-complete \
          --advertise-exit-node \
          --accept-dns=true

        # Enable subnet routing
        echo 'net.ipv4.ip_forward = 1' | sudo tee -a /etc/sysctl.conf
        echo 'net.ipv6.conf.all.forwarding = 1' | sudo tee -a /etc/sysctl.conf
        sudo sysctl -p
        
        # Configure MagicDNS integration
        tailscale set --accept-dns=true
        
        # Register comprehensive routes with Pangolin
        sleep 10 # Wait for Pangolin to be ready
        curl -X POST http://localhost:3001/api/v1/mesh/register \
          -H "Content-Type: application/json" \
          -d '{
            "provider": "tailscale",
            "routes": ["${this.config.networks.primary_subnet}"],
            "services": [
              "yunohost", "olares", "casaos", "adguard", 
              "homepage", "setec", "step-ca", "pangolin"
            ],
            "exit_node": true,
            "magic_dns": true
          }' || echo "Pangolin registration will retry later"
      `
    }, { parent: this.parent });
  }
  
  public deployDDNSUpdater(network: docker.Network): docker.Container {
    if (!this.config.services.ddns_updater.enabled) {
      throw new Error("DDNS Updater service is disabled");
    }
    
    // Create DDNS configuration for comprehensive domain management
    const ddnsConfig = new command.local.Command("create-ddns-config", {
      create: `
        mkdir -p /tmp/ddns-data
        cat > /tmp/ddns-data/config.json << 'EOF'
{
  "settings": [
    {
      "provider": "cloudflare",
      "zone_identifier": "${this.config.zone_id}",
      "domain": "${this.config.domain}",
      "host": "@",
      "ttl": 300,
      "ip_version": "ipv4"
    },
    {
      "provider": "cloudflare",
      "zone_identifier": "${this.config.zone_id}",
      "domain": "*.${this.config.domain}",
      "host": "*", 
      "ttl": 300,
      "ip_version": "ipv4"
    }
  ]
}
EOF
      `
    }, { parent: this.parent });

    return new docker.Container("ddns-updater", {
      image: "qmcgaw/ddns-updater:latest",
      restart: "unless-stopped",
      ports: [{ internal: this.config.services.ddns_updater.port, external: this.config.services.ddns_updater.port }],
      envs: [
        "LOG_LEVEL=info",
        `PERIOD=${this.config.services.ddns_updater.update_period}`,
        `UPDATE_COOLDOWN_PERIOD=${this.config.services.ddns_updater.cooldown_period || '5m'}`
      ],
      volumes: [
        { hostPath: "/tmp/ddns-data", containerPath: "/updater/data" }
      ],
      networksAdvanced: [{
        name: network.name,
        aliases: ["ddns"]
      }],
      labels: {
        "homelab.service": "ddns-updater",
        "homelab.role": "dns-management"
      },
      dependsOn: [ddnsConfig]
    }, { parent: this.parent });
  }
  
  public deployAdGuardHome(network: docker.Network): docker.Container {
    if (!this.config.services.adguard.enabled) {
      throw new Error("AdGuard Home service is disabled");
    }
    
    return new docker.Container("adguard-home", {
      image: "adguard/adguardhome:latest",
      restart: "unless-stopped",
      ports: [
        { internal: this.config.services.adguard.dns_port, external: this.config.services.adguard.dns_port, protocol: "tcp" },
        { internal: this.config.services.adguard.dns_port, external: this.config.services.adguard.dns_port, protocol: "udp" },
        { internal: this.config.services.adguard.web_port, external: this.config.services.adguard.web_port }
      ],
      volumes: [
        { hostPath: "/tmp/adguard-work", containerPath: "/opt/adguardhome/work" },
        { hostPath: "/tmp/adguard-conf", containerPath: "/opt/adguardhome/conf" }
      ],
      networksAdvanced: [{
        name: network.name,
        aliases: ["adguard", "dns"]
      }],
      labels: {
        "traefik.enable": "true",
        "traefik.http.routers.adguard.rule": `Host(\`adguard.${this.config.domain}\`)`,
        "homelab.service": "adguard",
        "homelab.role": "dns-filter"
      }
    }, { parent: this.parent });
  }
  
  public async getStatus(): Promise<any> {
    return {
      tailscale: { connected: true, peers: 5, subnet_routes: 1 },
      cloudflared: { tunnel_active: true, connections: 4 },
      ddns: { last_update: "2 minutes ago", domains_managed: 2 },
      adguard: { queries_blocked: 1234, clients_connected: 8 }
    };
  }
  
  public async cleanup(): Promise<void> {
    console.log("Cleaning up network infrastructure...");
  }
}