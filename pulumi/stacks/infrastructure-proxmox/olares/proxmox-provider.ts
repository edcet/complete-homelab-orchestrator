import * as pulumi from "@pulumi/pulumi";
import * as proxmoxve from "@muhlba91/pulumi-proxmoxve";
import { createK3s } from "./k3s-provider";
import { createPlatform } from "./platform-provider";
import { createRegistry } from "./registry-provider";
import { createDiscovery } from "./discovery-provider";
import { OlaresConfig } from "./types";

export function createOlares(name: string, cfg: OlaresConfig, opts?: pulumi.CustomResourceOptions) {
  const provider = opts?.provider as proxmoxve.Provider | undefined;

  const vm = new proxmoxve.vm.VirtualMachine(name, {
    name: cfg.services.olares.name || name,
    nodeName: cfg.hardware.r240.node_name || "pve",
    vmId: cfg.services.olares.vm_id || 2200,
    description: "Olares VM (native Pulumi)",
    cpu: { cores: cfg.services.olares.cores || 4 },
    memory: { dedicated: parseInt(String(cfg.services.olares.memory)) || 8192 },
    disks: [{
      interface: "scsi0",
      size: cfg.services.olares.disk_gb || 60,
      storage: cfg.hardware.r240.storage_id || "local-zfs",
      type: "disk",
      ssd: true,
    }],
    networkDevices: [{
      bridge: cfg.networks.primary.bridge || "vmbr0",
      vlanId: cfg.networks.primary.vlan,
      model: "virtio",
    }],
    agent: { enabled: true },
    onBoot: true,
    startOnCreate: true,
    iso: cfg.services.olares.os?.isoId, // assumed pre-uploaded template; no cloud-init
    osType: "l26",
    scsiHardware: "virtio-scsi-single",
  }, { provider });

  const k3s = createK3s(`${name}-k3s`, { vm }, opts);
  const platform = createPlatform(`${name}-platform`, { vm, k3s }, opts);
  const registry = createRegistry(`${name}-registry`, { vm, k3s }, opts);
  const discovery = createDiscovery(`${name}-discovery`, { vm, k3s, platform, registry }, opts);

  return { vm, k3s, platform, registry, discovery };
}
