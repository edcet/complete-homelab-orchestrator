import * as proxmoxve from "@muhlba91/pulumi-proxmoxve";
import * as pulumi from "@pulumi/pulumi";
import { HomelabConfig } from "../types/schemas";

export interface LXCConfig {
  vmId: number;
  hostname: string;
  template: string;
  cores: number;
  memory: number;
  storage: number;
  network: {
    bridge: string;
    dhcp?: boolean;
    ip?: string;
  };
  features?: {
    nesting?: boolean;
    mount?: string;
  };
  tags?: string[];
}

export interface VMConfig {
  vmId: number;
  name: string;
  cores: number;
  memory: number;
  disk: {
    size: number;
    storage: string;
  };
  network: {
    bridge: string;
    model?: string;
  };
  cloudInit?: {
    user: string;
    sshKeys: string[];
    packages?: string[];
    runcmd?: string[];
  };
  tags?: string[];
}

export class ProxmoxFactory {
  private provider: proxmoxve.Provider;
  private config: HomelabConfig;
  private nodeName: string;
  
  constructor(provider: proxmoxve.Provider, config: HomelabConfig, nodeName = "pve") {
    this.provider = provider;
    this.config = config;
    this.nodeName = nodeName;
  }

  createLXCContainer(containerConfig: LXCConfig, parent?: pulumi.ComponentResource): proxmoxve.Container {
    return new proxmoxve.Container(`lxc-${containerConfig.hostname}`, {
      nodeName: this.nodeName,
      vmId: containerConfig.vmId,
      description: `LXC container: ${containerConfig.hostname}`,
      
      osTemplate: containerConfig.template,
      password: process.env.PROXMOX_DEFAULT_PASSWORD || "homelab123",
      
      cpu: {
        cores: containerConfig.cores,
        units: 1024
      },
      
      memory: {
        dedicated: containerConfig.memory,
        swap: Math.floor(containerConfig.memory / 4) // 25% swap
      },
      
      disk: {
        datastoreId: "local-zfs",
        size: containerConfig.storage
      },
      
      networkInterface: {
        name: "eth0",
        bridge: containerConfig.network.bridge,
        enabled: true,
        dhcp: containerConfig.network.dhcp ?? true,
        ...(containerConfig.network.ip && {
          ipv4Config: {
            address: containerConfig.network.ip,
            gateway: this.config.networks.primary_subnet.replace(/0\/24$/, "1")
          }
        })
      },
      
      operatingSystem: {
        type: containerConfig.template.includes('ubuntu') ? 'ubuntu' : 'debian'
      },
      
      initialization: {
        hostname: containerConfig.hostname,
        dns: {
          domain: this.config.domain,
          servers: ["1.1.1.1", "8.8.8.8"]
        },
        userAccount: {
          keys: [process.env.SSH_PUBLIC_KEY || ""]
        }
      },
      
      features: {
        nesting: containerConfig.features?.nesting ?? false,
        mount: containerConfig.features?.mount || "nfs"
      },
      
      tags: containerConfig.tags || ["homelab", "lxc"],
      
      timeouts: {
        create: "10m",
        update: "5m",
        delete: "5m"
      }
    }, { 
      provider: this.provider,
      parent,
      deleteBeforeReplace: true
    });
  }

  createVM(vmConfig: VMConfig, parent?: pulumi.ComponentResource): proxmoxve.VirtualMachine {
    return new proxmoxve.VirtualMachine(`vm-${vmConfig.name}`, {
      nodeName: this.nodeName,
      vmId: vmConfig.vmId,
      name: vmConfig.name,
      description: `VM: ${vmConfig.name}`,
      
      cpu: {
        cores: vmConfig.cores,
        sockets: 1,
        type: "host"
      },
      
      memory: {
        dedicated: vmConfig.memory
      },
      
      agent: {
        enabled: true,
        trim: true,
        type: "virtio"
      },
      
      bios: "ovmf",
      
      disks: [{
        interface: "scsi0",
        datastoreId: vmConfig.disk.storage,
        size: vmConfig.disk.size,
        fileFormat: "qcow2",
        cache: "writethrough",
        ioThread: true
      }],
      
      networkDevices: [{
        enabled: true,
        bridge: vmConfig.network.bridge,
        model: vmConfig.network.model || "virtio"
      }],
      
      operatingSystem: {
        type: "l26" // Linux 2.6+ kernel
      },
      
      ...(vmConfig.cloudInit && {
        initialization: {
          type: "nocloud",
          datastoreId: vmConfig.disk.storage,
          userAccount: {
            username: vmConfig.cloudInit.user,
            keys: vmConfig.cloudInit.sshKeys
          },
          dns: {
            domain: this.config.domain,
            servers: ["1.1.1.1", "8.8.8.8"]
          },
          ipConfigs: [{
            ipv4: {
              address: "dhcp"
            }
          }]
        }
      }),
      
      tags: vmConfig.tags || ["homelab", "vm"],
      
      timeouts: {
        create: "15m",
        update: "10m",
        delete: "10m"
      }
    }, { 
      provider: this.provider,
      parent
    });
  }

  generateCloudInitConfig(vmConfig: VMConfig): string {
    return `#cloud-config
package_update: true
package_upgrade: true

${vmConfig.cloudInit?.packages ? `packages:\n${vmConfig.cloudInit.packages.map(pkg => `  - ${pkg}`).join('\n')}\n` : ''}

${vmConfig.cloudInit?.runcmd ? `runcmd:\n${vmConfig.cloudInit.runcmd.map(cmd => `  - ${cmd}`).join('\n')}\n` : ''}

final_message: "Cloud-init setup complete for ${vmConfig.name}"`;
  }

  async getContainerStatus(vmId: number): Promise<any> {
    // This would integrate with Proxmox API to get real-time status
    return {
      vmid: vmId,
      status: "running",
      uptime: 3600,
      memory_usage: "45%",
      cpu_usage: "12%"
    };
  }

  async getVMStatus(vmId: number): Promise<any> {
    // This would integrate with Proxmox API to get real-time status
    return {
      vmid: vmId,
      status: "running",
      uptime: 7200,
      memory_usage: "62%",
      cpu_usage: "28%"
    };
  }

  async listContainers(): Promise<any[]> {
    // This would query Proxmox API for all LXC containers
    return [
      { vmid: 200, name: "yunohost", status: "running", type: "lxc" },
      { vmid: 201, name: "olares", status: "running", type: "qemu" }
    ];
  }

  async healthCheck(): Promise<boolean> {
    try {
      // This would ping Proxmox API to verify connectivity
      return true;
    } catch {
      return false;
    }
  }
}