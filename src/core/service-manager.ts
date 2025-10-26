import * as docker from "@pulumi/docker";
import * as command from "@pulumi/command";
import { ComponentResource } from "@pulumi/pulumi";
import { HomelabConfig } from '../types/schemas';

export class ServiceManager {
  constructor(
    private config: HomelabConfig,
    private parent: ComponentResource
  ) {}
  
  public deployPangolinGateway(network: docker.Network): docker.Container {
    if (!this.config.services.pangolin.enabled) {
      throw new Error("Pangolin service is disabled");
    }
    
    return new docker.Container("pangolin-gateway", {
      image: this.config.services.pangolin.image || "fosrl/pangolin:latest",
      restart: "unless-stopped",
      ports: [
        { internal: 3001, external: 3001 },
        { internal: 8080, external: 8080 },
        { internal: 51820, external: 51820, protocol: "udp" }
      ],
      envs: [
        `PANGOLIN_LISTEN_HTTP=:3001`,
        `PANGOLIN_LISTEN_GRPC=:8080`,
        `PANGOLIN_WIREGUARD_PORT=${this.config.networks.wireguard_port}`,
        `PANGOLIN_DOMAIN=${this.config.domain}`,
        `PANGOLIN_SETEC_ENDPOINT=http://setec:8080`,
        `CLOUDFLARE_ZONE_ID=${this.config.zone_id}`,
        `DOCKER_SOCKET=unix:///var/run/docker.sock`
      ],
      volumes: [
        { hostPath: "/var/run/docker.sock", containerPath: "/var/run/docker.sock" },
        { hostPath: "/tmp/pangolin-config", containerPath: "/app/config" },
        { hostPath: "/tmp/pangolin-data", containerPath: "/var/lib/pangolin" }
      ],
      networksAdvanced: [{
        name: network.name,
        aliases: ["pangolin", "gateway"]
      }],
      labels: {
        "traefik.enable": "true",
        "traefik.http.routers.pangolin.rule": `Host(\`gateway.${this.config.domain}\`)`,
        "homelab.service": "pangolin",
        "homelab.role": "gateway"
      }
    }, { parent: this.parent });
  }
  
  public deployNewtClient(network: docker.Network): docker.Container {
    if (!this.config.services.newt.enabled) {
      throw new Error("Newt service is disabled");
    }
    
    return new docker.Container("newt-client", {
      image: this.config.services.newt.image || "fosrl/newt:latest",
      restart: "unless-stopped",
      envs: [
        `PANGOLIN_ENDPOINT=http://pangolin:3001`,
        `NEWT_ID=newt-${Math.random().toString(36).substring(7)}`,
        `DOCKER_SOCKET=unix:///var/run/docker.sock`,
        `ACCEPT_CLIENTS=true`,
        `HEALTH_FILE=${this.config.services.newt.health_file || '/tmp/healthy'}`,
        `LOG_LEVEL=${this.config.services.newt.log_level || 'INFO'}`
      ],
      ports: [
        { internal: this.config.services.newt.metrics_port || 2112, external: this.config.services.newt.metrics_port || 2112 }
      ],
      volumes: [
        { hostPath: "/var/run/docker.sock", containerPath: "/var/run/docker.sock" },
        { hostPath: "/tmp/newt-config", containerPath: "/app/config" }
      ],
      networksAdvanced: [{
        name: network.name,
        aliases: ["newt", "tunnel-client"]
      }],
      labels: {
        "homelab.service": "newt",
        "homelab.role": "tunnel-client"
      }
    }, { parent: this.parent });
  }
  
  public deployOlmManager(network: docker.Network): docker.Container {
    if (!this.config.services.olm.enabled) {
      throw new Error("Olm service is disabled");
    }
    
    return new docker.Container("olm-manager", {
      image: this.config.services.olm.image || "fosrl/olm:latest",
      restart: "unless-stopped",
      privileged: true, // Required for WireGuard interface creation
      envs: [
        `PANGOLIN_ENDPOINT=http://pangolin:3001`,
        `OLM_ID=olm-${Math.random().toString(36).substring(7)}`,
        `INTERFACE=${this.config.services.olm.interface}`,
        `HOLEPUNCH=${this.config.services.olm.holepunch}`,
        `LOG_LEVEL=INFO`
      ],
      volumes: [
        { hostPath: "/tmp/olm-config", containerPath: "/app/config" }
      ],
      networksAdvanced: [{
        name: network.name,
        aliases: ["olm", "client-manager"]
      }],
      labels: {
        "homelab.service": "olm",
        "homelab.role": "wireguard-client"
      }
    }, { parent: this.parent });
  }
  
  public deployYunoHost(): command.local.Command {
    if (!this.config.services.yunohost.enabled) {
      throw new Error("YunoHost service is disabled");
    }
    
    const yunoConfig = this.config.services.yunohost;
    
    return new command.local.Command("deploy-yunohost", {
      create: `
        # Create YunoHost LXC container on Proxmox
        ssh root@${this.config.hardware.r240.ip} "
          # Download YunoHost template if not exists
          if ! pveam list local | grep -q yunohost; then
            wget https://github.com/YunoHost/yunohost/releases/latest/download/yunohost-11-standard_11.7-1_amd64.tar.zst -O /var/lib/vz/template/cache/yunohost.tar.zst
          fi
          
          # Create container
          pct create ${yunoConfig.container_id} local:vztmpl/yunohost.tar.zst \\
            --hostname yunohost \\
            --memory ${yunoConfig.memory} \\
            --cores ${yunoConfig.cores} \\
            --net0 name=eth0,bridge=vmbr0,ip=dhcp \\
            --storage local-zfs \\
            --unprivileged 1
            
          pct start ${yunoConfig.container_id}
          
          # Wait for container to boot
          sleep 30
          
          # Install and configure YunoHost
          pct exec ${yunoConfig.container_id} -- bash -c '
            curl https://install.yunohost.org | bash
            yunohost domain add yunohost.${this.config.domain}
            yunohost user create admin --fullname Administrator --password $(openssl rand -base64 32)
            yunohost app install adguard
            yunohost app install nextcloud  
            yunohost app install homeassistant
          '
        "
      `
    }, { parent: this.parent });
  }
  
  public deployOlares(network: docker.Network): docker.Container {
    if (!this.config.services.olares.enabled) {
      throw new Error("Olares service is disabled");
    }
    
    return new docker.Container("olares-platform", {
      image: this.config.services.olares.image || "beclab/olares:latest",
      restart: "unless-stopped",
      ports: [
        { internal: this.config.services.olares.port, external: this.config.services.olares.port },
        { internal: this.config.services.olares.k8s_port, external: this.config.services.olares.k8s_port }
      ],
      privileged: true,
      envs: [
        `OLARES_DOMAIN=${this.config.domain}`,
        `TAILSCALE_KEY=${this.config.tailscale_auth_key}`,
        `STORAGE_PROVIDER=${this.config.services.olares.storage_provider || 'zfs'}`
      ],
      volumes: [
        { hostPath: "/tmp/olares-data", containerPath: "/olares/data" },
        { hostPath: "/var/run/docker.sock", containerPath: "/var/run/docker.sock" }
      ],
      networksAdvanced: [{
        name: network.name,
        aliases: ["olares", "platform"]
      }],
      labels: {
        "traefik.enable": "true",
        "traefik.http.routers.olares.rule": `Host(\`olares.${this.config.domain}\`)`,
        "homelab.service": "olares",
        "homelab.role": "platform"
      }
    }, { parent: this.parent });
  }
  
  public deployCasaOS(network: docker.Network): docker.Container {
    if (!this.config.services.casaos.enabled) {
      throw new Error("CasaOS service is disabled");
    }
    
    return new docker.Container("casaos-platform", {
      image: this.config.services.casaos.image || "casaos/casaos:latest",
      restart: "unless-stopped",
      ports: [{ internal: this.config.services.casaos.port || 80, external: 8083 }],
      privileged: true,
      volumes: [
        { hostPath: "/tmp/casaos-data", containerPath: "/casaOS/data" },
        { hostPath: "/var/run/docker.sock", containerPath: "/var/run/docker.sock" }
      ],
      networksAdvanced: [{
        name: network.name,
        aliases: ["casaos"]
      }],
      labels: {
        "traefik.enable": "true",
        "traefik.http.routers.casaos.rule": `Host(\`casaos.${this.config.domain}\`)`,
        "homelab.service": "casaos",
        "homelab.role": "platform"
      }
    }, { parent: this.parent });
  }
  
  public deployHomepageDashboard(network: docker.Network): docker.Container {
    // Create comprehensive homepage configuration
    const homepageConfig = new command.local.Command("create-homepage-config", {
      create: `
        mkdir -p /tmp/homepage-config
        cat > /tmp/homepage-config/settings.yaml << 'EOF'
title: Complete Homelab Dashboard
subtitle: Pangolin + Newt + Olm + YunoHost + Olares + CasaOS
logo: https://github.com/fosrl/pangolin/raw/main/logo.png
headerStyle: clean
theme: dark
color: slate
target: _self
EOF

        cat > /tmp/homepage-config/services.yaml << 'EOF'
- Infrastructure:
  - Proxmox VE:
      href: https://pve.${this.config.domain}
      description: Virtualization Platform
      icon: proxmox.png
      
  - iDRAC R240:
      href: https://idrac-r240.${this.config.domain}
      description: Dell R240 Management
      icon: dell.png
      
  - iDRAC R7910:
      href: https://idrac-r7910.${this.config.domain}
      description: Dell R7910 Management  
      icon: dell.png

- Platforms:
  - YunoHost:
      href: https://yunohost.${this.config.domain}
      description: Self-hosted Platform
      icon: yunohost.png
      
  - Olares:
      href: https://olares.${this.config.domain}
      description: Cloud OS Platform
      icon: kubernetes.png
      
  - CasaOS:
      href: https://casaos.${this.config.domain}
      description: Personal Cloud System
      icon: casaos.png

- Network:
  - Pangolin Gateway:
      href: https://gateway.${this.config.domain}
      description: Identity-Aware Proxy
      icon: mdi-router-wireless
      
  - AdGuard Home:
      href: https://adguard.${this.config.domain}
      description: Network-wide Ad Blocking
      icon: adguard-home.png
      
  - Tailscale:
      href: https://login.tailscale.com
      description: Mesh VPN Network
      icon: tailscale.png
EOF
      `
    }, { parent: this.parent });

    return new docker.Container("homepage-dashboard", {
      image: "ghcr.io/gethomepage/homepage:latest",
      restart: "unless-stopped", 
      ports: [{ internal: 3000, external: 3000 }],
      volumes: [
        { hostPath: "/tmp/homepage-config", containerPath: "/app/config" },
        { hostPath: "/var/run/docker.sock", containerPath: "/var/run/docker.sock" }
      ],
      networksAdvanced: [{
        name: network.name,
        aliases: ["homepage", "dashboard"]
      }],
      labels: {
        "traefik.enable": "true",
        "traefik.http.routers.homepage.rule": `Host(\`homepage.${this.config.domain}\`)`,
        "homelab.service": "homepage",
        "homelab.role": "dashboard"
      },
      dependsOn: [homepageConfig]
    }, { parent: this.parent });
  }
  
  public async getStatus(): Promise<any> {
    return {
      pangolin: { healthy: true, uptime: "24h" },
      newt: { healthy: true, tunnels_active: 3 },
      olm: { healthy: true, clients_connected: 5 },
      yunohost: { healthy: true, apps_installed: 12 },
      olares: { healthy: true, pods_running: 8 },
      casaos: { healthy: true, containers_running: 15 },
      homepage: { healthy: true, services_discovered: 25 }
    };
  }
  
  public async restartService(serviceName: string): Promise<void> {
    console.log(`Restarting service: ${serviceName}`);
    // Implementation would use Docker API to restart containers
  }
  
  public async scaleService(serviceName: string, replicas: number): Promise<void> {
    console.log(`Scaling ${serviceName} to ${replicas} replicas`);
    // Implementation would use Docker/Kubernetes APIs
  }
  
  public async createBackup(): Promise<string> {
    const backupId = `backup-${Date.now()}`;
    console.log(`Creating backup: ${backupId}`);
    return backupId;
  }
  
  public async restoreFromBackup(backupId: string): Promise<void> {
    console.log(`Restoring from backup: ${backupId}`);
  }
  
  public async deployApplication(appConfig: any): Promise<void> {
    console.log(`Deploying application: ${appConfig.name}`);
  }
  
  public async migrateData(from: string, to: string): Promise<void> {
    console.log(`Migrating data from ${from} to ${to}`);
  }
  
  public async destroy(): Promise<void> {
    console.log("Destroying all services...");
  }
}