import * as pulumi from "@pulumi/pulumi";
import * as proxmox from "@muhlba91/pulumi-proxmoxve";
import type { CasaOSConfig } from "./types";

export interface CasaOSProxmoxProviderArgs {
  config: CasaOSConfig;
  proxmoxProvider: proxmox.Provider;
}

export class CasaOSProxmoxProvider extends pulumi.ComponentResource {
  public readonly vm: proxmox.vm.VirtualMachine;
  public readonly ipAddress: pulumi.Output<string>;

  constructor(
    name: string,
    args: CasaOSProxmoxProviderArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("homelab:casaos:ProxmoxProvider", name, {}, opts);

    const { config, proxmoxProvider } = args;

    // Create VM with CasaOS-optimized configuration
    this.vm = new proxmox.vm.VirtualMachine(
      `${name}-vm`,
      {
        nodeName: config.proxmox.node,
        name: config.vm.name,
        description: "CasaOS Personal Cloud - Native Pulumi Deployment",
        
        // Boot from cloud-init enabled template
        clone: {
          vmId: config.vm.templateId,
          full: true,
          dataStoreId: config.proxmox.storage,
        },

        // Resource allocation
        cpu: {
          cores: config.vm.cores || 4,
          sockets: 1,
          type: "host",
        },
        memory: {
          dedicated: config.vm.memory || 8192,
        },

        // Network configuration
        networkDevices: [
          {
            bridge: config.network.bridge || "vmbr0",
            model: "virtio",
            firewall: false,
          },
        ],

        // Disk configuration
        disks: [
          {
            interface: "scsi0",
            size: config.vm.diskSize || 100,
            dataStoreId: config.proxmox.storage,
            discard: "on",
            iothread: true,
          },
        ],

        // Cloud-init configuration for CasaOS
        initialization: {
          type: "nocloud",
          dataStoreId: config.proxmox.storage,
          userAccount: {
            username: config.ssh.user,
            keys: [config.ssh.publicKey],
            password: pulumi.secret(config.ssh.password || "casaos"),
          },
          ipConfigs: [
            {
              ipv4: {
                address: config.network.ipAddress
                  ? `${config.network.ipAddress}/${config.network.netmask || "24"}`
                  : "dhcp",
                gateway: config.network.gateway,
              },
            },
          ],
          dns: {
            servers: config.network.dns || ["8.8.8.8", "8.8.4.4"],
          },
          // User data for CasaOS installation
          userDataFileId: pulumi.interpolate`local:snippets/casaos-init.yml`,
        },

        // VM settings
        agent: {
          enabled: true,
          trim: true,
          type: "virtio",
        },
        onBoot: true,
        started: true,
        
        // Tags for organization
        tags: ["casaos", "personal-cloud", "homelab"],
      },
      { provider: proxmoxProvider, parent: this }
    );

    // Extract IP address
    this.ipAddress = this.vm.initialization.apply((init) => {
      if (init?.ipConfigs && init.ipConfigs[0]?.ipv4?.address) {
        const addr = init.ipConfigs[0].ipv4.address;
        return addr.includes("/") ? addr.split("/")[0] : addr;
      }
      return config.network.ipAddress || "";
    });

    this.registerOutputs({
      vm: this.vm,
      ipAddress: this.ipAddress,
    });
  }
}
