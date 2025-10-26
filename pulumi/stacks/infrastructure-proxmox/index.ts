import * as pulumi from "@pulumi/pulumi";
import * as proxmoxve from "@muhlba91/pulumi-proxmoxve";
import * as command from "@pulumi/command";
import { HomelabConfig } from "../../../src/types/schemas";

const config = new pulumi.Config();
const homelabConfig: HomelabConfig = config.requireObject("homelab");
const escSecrets = new pulumi.Config("secrets");

// Proxmox provider configuration
const proxmoxProvider = new proxmoxve.Provider("proxmox-r240", {
  endpoint: `https://${homelabConfig.hardware.r240.ip}:${homelabConfig.hardware.r240.proxmox_port || 8006}/api2/json`,
  username: "root@pam",
  password: escSecrets.requireSecret("proxmox-password"),
  insecure: true,
  ssh: {
    agent: false,
    username: "root",
    password: escSecrets.requireSecret("proxmox-password")
  }
});

// ZFS storage configuration
const zfsStorage = new proxmoxve.Storage("homelab-zfs", {
  nodeNames: ["pve"],
  type: "zfspool",
  storageId: "local-zfs",
  pool: "rpool/data",
  content: ["images", "rootdir"],
  sparse: true
}, { provider: proxmoxProvider });

// Network bridge configuration (if needed)
const homelabBridge = new proxmoxve.Network.Bridge("homelab-bridge", {
  nodeName: "pve",
  name: "vmbr1",
  comment: "Homelab isolated network bridge",
  ports: ["eno2"], // Assuming second NIC for isolated network
  vlanAware: true
}, { provider: proxmoxProvider, dependsOn: [zfsStorage] });

// YunoHost LXC container (conditional deployment)
let yunohostContainer: proxmoxve.Container | undefined;
if (homelabConfig.services.yunohost.enabled) {
  yunohostContainer = new proxmoxve.Container("yunohost-platform", {
    nodeName: "pve",
    vmId: homelabConfig.services.yunohost.container_id || 200,
    description: "YunoHost Self-Hosting Platform",
    
    osTemplate: "local:vztmpl/debian-12-standard_12.2-1_amd64.tar.zst",
    password: escSecrets.requireSecret("yunohost-root-password"),
    
    cpu: {
      cores: homelabConfig.services.yunohost.cores || 2,
      units: 1024
    },
    
    memory: {
      dedicated: parseInt(homelabConfig.services.yunohost.memory) || 4096,
      swap: 512
    },
    
    disk: {
      datastoreId: "local-zfs",
      size: 32
    },
    
    networkInterface: {
      name: "eth0",
      bridge: "vmbr0",
      enabled: true,
      dhcp: true,
      rateLimit: 1000 // 1Gbps limit
    },
    
    operatingSystem: {
      type: "debian"
    },
    
    initialization: {
      hostname: "yunohost",
      dns: {
        domain: homelabConfig.domain,
        servers: ["1.1.1.1", "8.8.8.8"]
      },
      ipConfigs: [{
        ipv4: {
          address: "dhcp"
        }
      }],
      userAccount: {
        keys: [escSecrets.require("ssh-public-key")],
        password: escSecrets.requireSecret("yunohost-root-password")
      }
    },
    
    features: {
      nesting: true, // Required for Docker/systemd
      mount: "nfs;cifs"
    },
    
    tags: ["platform", "yunohost", "debian"],
    
    timeouts: {
      create: "10m",
      update: "5m"
    }
  }, { 
    provider: proxmoxProvider,
    dependsOn: [zfsStorage],
    deleteBeforeReplace: true
  });
}

// Olares K3s VM (conditional deployment)
let olaresVM: proxmoxve.VirtualMachine | undefined;
if (homelabConfig.services.olares.enabled) {
  olaresVM = new proxmoxve.VirtualMachine("olares-k3s", {
    nodeName: "pve",
    vmId: 201,
    name: "olares-cloudos",
    description: "Olares Cloud OS with K3s",
    tags: ["platform", "olares", "k3s", "ubuntu"],
    
    cpu: {
      cores: 4,
      sockets: 1,
      type: "host"
    },
    
    memory: {
      dedicated: 8192
    },
    
    agent: {
      enabled: true,
      trim: true,
      type: "virtio"
    },
    
    bios: "ovmf",
    
    disks: [{
      interface: "scsi0",
      datastoreId: "local-zfs",
      size: 64,
      fileFormat: "qcow2",
      cache: "writethrough",
      ioThread: true
    }],
    
    networkDevices: [{
      enabled: true,
      bridge: "vmbr0",
      model: "virtio",
      rateLimit: 1000
    }],
    
    operatingSystem: {
      type: "l26"
    },
    
    initialization: {
      type: "nocloud",
      datastoreId: "local-zfs",
      
      userAccount: {
        username: "olares",
        password: escSecrets.requireSecret("olares-password"),
        keys: [escSecrets.require("ssh-public-key")]
      },
      
      dns: {
        domain: homelabConfig.domain,
        servers: ["1.1.1.1", "8.8.8.8"]
      },
      
      ipConfigs: [{
        ipv4: {
          address: "dhcp"
        }
      }],
      
      userDataFileId: pulumi.interpolate`local:snippets/olares-cloud-init-${Date.now()}.yaml`
    },
    
    timeouts: {
      create: "15m",
      update: "10m"
    }
  }, { 
    provider: proxmoxProvider,
    dependsOn: [zfsStorage]
  });
}

// Cloud-init configuration for Olares
const olaresCloudInit = homelabConfig.services.olares.enabled ? new command.remote.Command("create-olares-cloud-init", {
  connection: {
    host: homelabConfig.hardware.r240.ip,
    user: "root",
    password: escSecrets.requireSecret("proxmox-password")
  },
  create: pulumi.interpolate`
    mkdir -p /var/lib/vz/snippets
    cat > /var/lib/vz/snippets/olares-cloud-init-${Date.now()}.yaml << 'CLOUDINIT'
#cloud-config
package_update: true
package_upgrade: true

packages:
  - curl
  - wget
  - git
  - htop
  - net-tools
  - docker.io
  - docker-compose
  - unattended-upgrades
  
runcmd:
  # Install K3s with OIDC configuration
  - curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC='server --disable traefik --disable servicelb --oidc-issuer-url=https://auth.${homelabConfig.domain} --oidc-client-id=larepass --oidc-username-claim=email --oidc-groups-claim=groups' sh -
  
  # Install Tailscale
  - curl -fsSL https://tailscale.com/install.sh | sh
  - tailscale up --authkey=${homelabConfig.tailscale_auth_key} --advertise-tags=tag:olares,tag:k3s,tag:platform
  
  # Install Olares
  - curl -fsSL https://github.com/beclab/olares/raw/main/install/install.sh | bash
  
  # Configure Olares with homelab domain
  - mkdir -p /etc/olares
  - echo '${homelabConfig.domain}' > /etc/olares/domain
  - echo 'k3s_cluster_init=true' >> /etc/olares/config
  
  # Setup systemd services
  - systemctl enable --now k3s
  - systemctl enable --now tailscaled
  - systemctl enable --now docker
  
  # Configure automatic updates
  - echo 'Unattended-Upgrade::Automatic-Reboot "false";' >> /etc/apt/apt.conf.d/50unattended-upgrades
  
  # Set up log rotation
  - echo '/var/log/olares/*.log { daily missingok rotate 7 compress delaycompress notifempty }' > /etc/logrotate.d/olares
  
write_files:
  - path: /etc/rancher/k3s/registries.yaml
    content: |
      mirrors:
        docker.io:
          endpoint:
            - "https://registry-1.docker.io"
        ghcr.io:
          endpoint:
            - "https://ghcr.io"
      
  - path: /etc/systemd/system/olares-healthcheck.service
    content: |
      [Unit]
      Description=Olares Health Check
      After=network.target
      
      [Service]
      Type=oneshot
      ExecStart=/usr/bin/curl -f http://localhost:8080/health
      
      [Install]
      WantedBy=multi-user.target
      
  - path: /etc/systemd/system/olares-healthcheck.timer
    content: |
      [Unit]
      Description=Run Olares Health Check every 5 minutes
      
      [Timer]
      OnBootSec=5min
      OnUnitActiveSec=5min
      
      [Install]
      WantedBy=timers.target

final_message: "Olares Cloud OS initialization complete. K3s cluster ready at https://${homelabConfig.domain}:6443"
CLOUDINIT
    echo "Cloud-init configuration created for Olares VM"
  `
}, { dependsOn: [olaresVM] }) : undefined;

// Post-provision YunoHost setup
const yunohostSetup = homelabConfig.services.yunohost.enabled && yunohostContainer ? new command.remote.Command("yunohost-post-provision", {
  connection: {
    host: pulumi.interpolate`${yunohostContainer!.ipv4Addresses[0]}`,
    user: "root",
    password: escSecrets.requireSecret("yunohost-root-password")
  },
  create: `
    # Wait for container to be fully ready
    sleep 60
    
    # Update packages
    apt-get update && apt-get upgrade -y
    
    # Install YunoHost
    curl https://install.yunohost.org | bash -s -- -a
    
    # Post-installation configuration
    yunohost tools postinstall --domain yunohost.${homelabConfig.domain} --password "$(openssl rand -base64 32)"
    
    # Create admin user
    yunohost user create admin --firstname "Administrator" --lastname "User" --domain yunohost.${homelabConfig.domain} --password "$(openssl rand -base64 32)"
    
    # Install essential apps
    yunohost app install adguardhome --force
    yunohost app install nextcloud --force
    yunohost app install grafana --force
    
    # Configure LDAP/SSO integration
    yunohost app install larepass --force
    
    # Install Tailscale for mesh networking
    curl -fsSL https://tailscale.com/install.sh | sh
    tailscale up --authkey=${homelabConfig.tailscale_auth_key} --advertise-tags=tag:yunohost,tag:platform --advertise-routes=${homelabConfig.networks.primary_subnet}
    
    # Setup firewall rules
    ufw allow 22/tcp
    ufw allow 80/tcp  
    ufw allow 443/tcp
    ufw --force enable
    
    echo "YunoHost setup completed successfully"
  `
}, { 
  dependsOn: [yunohostContainer],
  timeouts: { create: "20m" }
}) : undefined;

// Export infrastructure details
export const proxmoxEndpoint = `https://${homelabConfig.hardware.r240.ip}:${homelabConfig.hardware.r240.proxmox_port || 8006}`;
export const zfsStorageId = zfsStorage.storageId;
export const yunohostIP = yunohostContainer?.ipv4Addresses;
export const yunohostVMID = yunohostContainer?.vmId;
export const olaresIP = olaresVM?.ipv4Addresses;
export const olaresVMID = olaresVM?.vmId;
export const infrastructureStatus = {
  yunohost_enabled: homelabConfig.services.yunohost.enabled,
  olares_enabled: homelabConfig.services.olares.enabled,
  zfs_storage: "local-zfs",
  bridge_network: "vmbr0"
};