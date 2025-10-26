import axios, { AxiosInstance } from "axios";

export interface CloudflareDNSRecord {
  id?: string;
  type: "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "SRV";
  name: string;
  content: string;
  ttl?: number;
  proxied?: boolean;
  comment?: string;
  tags?: string[];
}

export interface CloudflareTunnel {
  id: string;
  name: string;
  secret: string;
  created_at: string;
  deleted_at?: string;
  connections: any[];
}

export class CloudflareClient {
  private client: AxiosInstance;
  private zoneId: string;
  
  constructor(apiToken: string, zoneId: string) {
    this.zoneId = zoneId;
    this.client = axios.create({
      baseURL: 'https://api.cloudflare.com/client/v4',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
  }

  // DNS Record management
  async createDNSRecord(record: CloudflareDNSRecord): Promise<CloudflareDNSRecord> {
    try {
      const response = await this.client.post(`/zones/${this.zoneId}/dns_records`, record);
      console.log(`✅ Created DNS record: ${record.name} -> ${record.content}`);
      return response.data.result;
    } catch (error) {
      if (error.response?.data?.errors?.[0]?.code === 81057) {
        console.log(`📋 DNS record ${record.name} already exists`);
        return await this.getDNSRecordByName(record.name);
      }
      throw new Error(`Failed to create DNS record: ${error.message}`);
    }
  }

  async getDNSRecordByName(name: string): Promise<CloudflareDNSRecord> {
    const response = await this.client.get(`/zones/${this.zoneId}/dns_records?name=${encodeURIComponent(name)}`);
    if (response.data.result?.length > 0) {
      return response.data.result[0];
    }
    throw new Error(`DNS record not found: ${name}`);
  }

  async updateDNSRecord(recordId: string, updates: Partial<CloudflareDNSRecord>): Promise<CloudflareDNSRecord> {
    const response = await this.client.patch(`/zones/${this.zoneId}/dns_records/${recordId}`, updates);
    console.log(`✅ Updated DNS record: ${recordId}`);
    return response.data.result;
  }

  async deleteDNSRecord(recordId: string): Promise<void> {
    await this.client.delete(`/zones/${this.zoneId}/dns_records/${recordId}`);
    console.log(`✅ Deleted DNS record: ${recordId}`);
  }

  // Tunnel management
  async createTunnel(name: string): Promise<CloudflareTunnel> {
    const tunnel = {
      name,
      tunnel_secret: this.generateTunnelSecret()
    };
    
    const response = await this.client.post('/accounts/your-account-id/cfd_tunnel', tunnel);
    console.log(`✅ Created Cloudflare tunnel: ${name}`);
    return response.data.result;
  }

  async getTunnels(): Promise<CloudflareTunnel[]> {
    const response = await this.client.get('/accounts/your-account-id/cfd_tunnel');
    return response.data.result || [];
  }

  async getTunnelToken(tunnelId: string): Promise<string> {
    const response = await this.client.get(`/accounts/your-account-id/cfd_tunnel/${tunnelId}/token`);
    return response.data.result;
  }

  // Zone management
  async getZoneInfo(): Promise<any> {
    const response = await this.client.get(`/zones/${this.zoneId}`);
    return response.data.result;
  }

  // Bulk homelab DNS setup
  async setupHomelabDNS(domain: string, gatewayIP: string): Promise<void> {
    const records: CloudflareDNSRecord[] = [
      { type: "A", name: "@", content: gatewayIP, proxied: true },
      { type: "A", name: "*", content: gatewayIP, proxied: true },
      { type: "A", name: "gateway", content: gatewayIP, proxied: true },
      { type: "A", name: "pve", content: gatewayIP, proxied: true },
      { type: "A", name: "netbox", content: gatewayIP, proxied: true },
      { type: "A", name: "grafana", content: gatewayIP, proxied: true },
      { type: "A", name: "adguard", content: gatewayIP, proxied: false }, // DNS service
      { type: "A", name: "homepage", content: gatewayIP, proxied: true },
      { type: "A", name: "yunohost", content: gatewayIP, proxied: true },
      { type: "A", name: "olares", content: gatewayIP, proxied: true },
      { type: "A", name: "casaos", content: gatewayIP, proxied: true },
      { type: "A", name: "setec", content: gatewayIP, proxied: true },
      { type: "A", name: "ca", content: gatewayIP, proxied: true },
      { type: "A", name: "ssh", content: gatewayIP, proxied: true },
      { type: "A", name: "api", content: gatewayIP, proxied: true },
      { type: "A", name: "idrac-r240", content: gatewayIP, proxied: true },
      { type: "A", name: "idrac-r7910", content: gatewayIP, proxied: true }
    ];

    const results = await Promise.allSettled(
      records.map(record => this.createDNSRecord(record))
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    console.log(`✅ Created ${successful} DNS records${failed > 0 ? `, ${failed} failed` : ''}`);
  }

  private generateTunnelSecret(): string {
    // Generate base64-encoded 32-byte secret
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
    return Buffer.from(bytes).toString('base64');
  }

  async healthCheck(): Promise<boolean> {
    try {
      const zone = await this.getZoneInfo();
      return zone && zone.status === 'active';
    } catch {
      return false;
    }
  }
}