import * as pulumi from "@pulumi/pulumi";
import * as proxmoxve from "@muhlba91/pulumi-proxmoxve";
import { HomelabConfig } from "../../../src/types/schemas";
import { YunoHost, createYunoHost } from "./yunohost";
import { createOlares } from "./olares/proxmox-provider";
import { CasaOSStack } from "./casaos";

const config = new pulumi.Config();
const homelabConfig: HomelabConfig = config.requireObject("homelab");
const escSecrets = new pulumi.Config("secrets");

// Proxmox provider configuration (native)
const proxmoxProvider = new proxmoxve.Provider("proxmox", {
  endpoint: `https://${homelabConfig.hardware.r240.ip}:${homelabConfig.hardware.r240.proxmox_port || 8006}/api2/json`,
  username: "root@pam",
  password: escSecrets.requireSecret("proxmox-password"),
  insecure: true,
});

// Storage (native)
const zfsStorage = new proxmoxve.Storage("homelab-zfs", {
  nodeNames: [homelabConfig.hardware.r240.node_name || "pve"],
  type: "zfspool",
  storageId: homelabConfig.hardware.r240.storage_id || "local-zfs",
  pool: homelabConfig.hardware.r240.zfs_pool || "rpool/data",
  content: ["images", "rootdir"],
  sparse: true,
}, { provider: proxmoxProvider });

// Build YunoHost using pure Pulumi resources
if (homelabConfig.services.yunohost.enabled) {
  const yh = createYunoHost("yunohost", {
    nodeName: homelabConfig.hardware.r240.node_name || "pve",
    vmId: homelabConfig.services.yunohost.vm_id || 2100,
    name: homelabConfig.services.yunohost.name || "yunohost",
    description: "YunoHost VM (pure Pulumi)",
    cpu: { cores: homelabConfig.services.yunohost.cores || 4 },
    memory: { dedicated: parseInt(homelabConfig.services.yunohost.memory) || 4096 },
    disk: {
      size: homelabConfig.services.yunohost.disk_gb || 40,
      storage: homelabConfig.hardware.r240.storage_id || "local-zfs",
      interface: "scsi0",
    },
    network: {
      bridge: homelabConfig.networks.primary.bridge || "vmbr0",
      vlan: homelabConfig.networks.primary.vlan,
      ip: homelabConfig.services.yunohost.ip || "dhcp",
      gateway: homelabConfig.networks.primary.gateway,
      nameservers: homelabConfig.networks.primary.nameservers,
    },
    yunohost: {
      domain: homelabConfig.services.yunohost.domain,
      adminPassword: escSecrets.requireSecret("yunohost-admin-password"),
      adminUser: "admin",
    },
    apps: homelabConfig.services.yunohost.apps?.map(a => ({
      name: a.name,
      domain: a.domain || homelabConfig.services.yunohost.domain,
      path: a.path,
      args: a.args,
    })),
    firewall: {
      enabled: true,
      rules: [
        { type: "in", action: "ACCEPT", protocol: "tcp", dport: "22", comment: "SSH" },
        { type: "in", action: "ACCEPT", protocol: "tcp", dport: "80", comment: "HTTP" },
        { type: "in", action: "ACCEPT", protocol: "tcp", dport: "443", comment: "HTTPS" },
      ],
    },
    sso: { enabled: true },
  }, { provider: proxmoxProvider });

  export const yunohostIp = yh.instance.ip;
  export const yunohostDomain = yh.instance.domain;
  export const apps = yh.instance.apps;
}

// Build Olares using pure Pulumi resources (no shell, no cloud-init)
if ((homelabConfig as any).services?.olares?.enabled) {
  const ol = createOlares("olares", homelabConfig as any, { provider: proxmoxProvider });
  export const olaresVmId = ol.vm.id;
}

// Build CasaOS using pure Pulumi resources
if ((homelabConfig as any).services?.casaos?.enabled) {
  const casaosConfig = (homelabConfig as any).services.casaos;
  const casaos = new CasaOSStack(
    "casaos",
    {
      config: {
        proxmox: {
          node: homelabConfig.hardware.r240.node_name || "pve",
          storage: homelabConfig.hardware.r240.storage_id || "local-zfs",
        },
        vm: {
          name: casaosConfig.name || "casaos",
          templateId: casaosConfig.template_id || 9000,
          cores: casaosConfig.cores || 4,
          memory: parseInt(casaosConfig.memory) || 8192,
          diskSize: casaosConfig.disk_gb || 100,
        },
        network: {
          bridge: homelabConfig.networks.primary.bridge || "vmbr0",
          ipAddress: casaosConfig.ip,
          netmask: "24",
          gateway: homelabConfig.networks.primary.gateway,
          dns: homelabConfig.networks.primary.nameservers,
        },
        ssh: {
          user: casaosConfig.ssh_user || "ubuntu",
          publicKey: escSecrets.require("ssh-public-key"),
          privateKey: escSecrets.requireSecret("ssh-private-key"),
        },
        apps: casaosConfig.apps || [],
      },
      proxmoxProvider: proxmoxProvider,
    },
    { provider: proxmoxProvider }
  );

  export const casaosVmId = casaos.vm.id;
  export const casaosIp = casaos.ipAddress;
  export const casaosEndpoint = casaos.apiEndpoint;
  export const casaosApps = casaos.apps;
}
