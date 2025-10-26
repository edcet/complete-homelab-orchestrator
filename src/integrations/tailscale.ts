import axios, { AxiosInstance } from "axios";

export interface TailscaleDevice {
  id: string;
  name: string;
  addresses: string[];
  hostname: string;
  os: string;
  user: string;
  tags: string[];
  keyExpiryDisabled: boolean;
  expires: string;
  authorized: boolean;
  isExternal: boolean;
  machineKey: string;
  nodeKey: string;
  clientVersion: string;
  lastSeen: string;
}

export interface TailscaleACL {
  acls: Array<{
    action: "accept" | "drop";
    src: string[];
    dst: string[];
    proto?: string;
  }>;
  hosts: Record<string, string>;
  tagOwners: Record<string, string[]>;
  autoApprovers?: {
    routes?: Record<string, string[]>;
    exitNode?: string[];
  };
}

export class TailscaleClient {
  private client: AxiosInstance;
  private tailnet: string;
  
  constructor(apiKey: string, tailnet?: string) {
    this.tailnet = tailnet || 'your-tailnet.ts.net';
    this.client = axios.create({
      baseURL: 'https://api.tailscale.com/api/v2',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
  }

  async getDevices(): Promise<TailscaleDevice[]> {
    const response = await this.client.get(`/tailnet/${this.tailnet}/devices`);
    return response.data.devices || [];
  }

  async getDevice(deviceId: string): Promise<TailscaleDevice> {
    const response = await this.client.get(`/device/${deviceId}`);
    return response.data;
  }

  async updateDeviceTags(deviceId: string, tags: string[]): Promise<void> {
    await this.client.post(`/device/${deviceId}/tags`, { tags });
    console.log(`✅ Updated device tags for ${deviceId}`);
  }

  async authorizeDevice(deviceId: string): Promise<void> {
    await this.client.post(`/device/${deviceId}/authorized`, { authorized: true });
    console.log(`✅ Authorized device ${deviceId}`);
  }

  // ACL management
  async getACL(): Promise<TailscaleACL> {
    const response = await this.client.get(`/tailnet/${this.tailnet}/acl`);
    return response.data;
  }

  async updateACL(acl: TailscaleACL): Promise<void> {
    await this.client.post(`/tailnet/${this.tailnet}/acl`, acl);
    console.log("✅ Updated Tailscale ACL");
  }

  // Route management
  async getRoutes(): Promise<any[]> {
    const response = await this.client.get(`/tailnet/${this.tailnet}/routes`);
    return response.data.routes || [];
  }

  async approveRoute(routeId: string): Promise<void> {
    await this.client.post(`/tailnet/${this.tailnet}/routes/${routeId}/approve`);
    console.log(`✅ Approved route ${routeId}`);
  }

  // Generate comprehensive homelab ACL
  async generateHomelabACL(domain: string, subnet: string): Promise<TailscaleACL> {
    return {
      acls: [
        {
          action: "accept",
          src: ["autogroup:admin"],
          dst: ["*:*"]
        },
        {
          action: "accept",
          src: ["tag:homelab"],
          dst: ["tag:homelab:*", `${subnet}:*`]
        },
        {
          action: "accept",
          src: ["tag:service"],
          dst: ["tag:service:*", "tag:homelab:443,80,22"]
        }
      ],
      hosts: {
        "homelab-gateway": subnet.split('/')[0].replace(/\d+$/, '24'),
        "r240": subnet.split('/')[0].replace(/\d+$/, '24'),
        "r7910": subnet.split('/')[0].replace(/\d+$/, '25')
      },
      tagOwners: {
        "tag:homelab": ["autogroup:admin"],
        "tag:service": ["autogroup:admin"],
        "tag:infrastructure": ["autogroup:admin"]
      },
      autoApprovers: {
        routes: {
          [subnet]: ["tag:homelab"]
        },
        exitNode: ["tag:homelab"]
      }
    };
  }

  async syncHomelabDevices(devices: Array<{ name: string; ip: string; role: string }>): Promise<void> {
    const tailscaleDevices = await this.getDevices();
    
    for (const device of devices) {
      const existing = tailscaleDevices.find(td => 
        td.name.includes(device.name) || td.addresses.includes(device.ip)
      );
      
      if (existing) {
        const newTags = [`tag:homelab`, `tag:${device.role}`];
        await this.updateDeviceTags(existing.id, newTags);
        
        if (!existing.authorized) {
          await this.authorizeDevice(existing.id);
        }
      }
    }
    
    console.log(`✅ Synced ${devices.length} devices with Tailscale`);
  }
}