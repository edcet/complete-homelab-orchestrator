/**
 * Proxmox Initialization Dynamic Provider
 * 
 * Executes initialization actions on a Proxmox VM/LXC via Proxmox API
 * without SSH or remote-command providers. Supports file upload and exec.
 */

import * as pulumi from "@pulumi/pulumi";
import axios from "axios";

export interface ProxmoxInitInputs {
  apiUrl: string; // https://proxmox.example:8006/api2/json
  tokenId: string; // pveuser@pve!token
  tokenSecret: pulumi.Output<string> | string;
  node: string; // proxmox node name
  vmId: number; // VMID
  files?: Array<{ path: string; content: string; mode?: number }>;
  commands?: string[]; // commands to run inside guest via qemu-agent
  timeoutSeconds?: number;
}

export interface ProxmoxInitOutputs {
  id: string;
  vmId: number;
  executed: boolean;
  details?: string;
}

class ProxmoxInitProvider implements pulumi.dynamic.ResourceProvider {
  private async client(cfg: ProxmoxInitInputs) {
    const token = typeof cfg.tokenSecret === 'string' ? cfg.tokenSecret : await (cfg.tokenSecret as any);
    const headers = {
      Authorization: `PVEAPIToken=${cfg.tokenId}=${token}`,
    };
    const api = axios.create({ baseURL: cfg.apiUrl, headers, timeout: (cfg.timeoutSeconds || 120) * 1000 });
    return api;
  }

  async create(inputs: ProxmoxInitInputs): Promise<pulumi.dynamic.CreateResult> {
    const api = await this.client(inputs);

    // Upload files via Proxmox guest-file API (requires qemu-guest-agent)
    if (inputs.files && inputs.files.length > 0) {
      for (const f of inputs.files) {
        const payload = {
          file: Buffer.from(f.content).toString('base64'),
          path: f.path,
          mode: f.mode || 0o644,
        };
        await api.post(`/nodes/${inputs.node}/qemu/${inputs.vmId}/agent/file-write`, payload);
      }
    }

    // Execute commands via qemu-guest-agent exec
    if (inputs.commands && inputs.commands.length > 0) {
      for (const cmd of inputs.commands) {
        await api.post(`/nodes/${inputs.node}/qemu/${inputs.vmId}/agent/exec`, { command: cmd });
      }
    }

    const id = `proxmox-init-${inputs.node}-${inputs.vmId}-${Date.now()}`;
    return { id, outs: { id, vmId: inputs.vmId, executed: true } };
  }

  async update(id: string, olds: ProxmoxInitOutputs, news: ProxmoxInitInputs): Promise<pulumi.dynamic.UpdateResult> {
    // Re-run with new inputs
    await this.create(news);
    return { outs: { id, vmId: news.vmId, executed: true } as any };
  }

  async delete(id: string): Promise<void> {
    // No-op
  }
}

export class ProxmoxInit extends pulumi.dynamic.Resource {
  public readonly vmId!: pulumi.Output<number>;
  public readonly executed!: pulumi.Output<boolean>;

  constructor(name: string, args: ProxmoxInitInputs, opts?: pulumi.CustomResourceOptions) {
    super(new ProxmoxInitProvider(), name, { vmId: undefined, executed: undefined }, { ...opts, ...args });
  }
}
