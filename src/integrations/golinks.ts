import axios, { AxiosInstance } from "axios";

export interface GoLink {
  keyword: string;
  url: string;
  description?: string;
  created_at?: string;
  click_count?: number;
}

export class GoLinkManager {
  private client: AxiosInstance;
  
  constructor(baseUrl: string, apiKey?: string) {
    this.client = axios.create({
      baseURL: baseUrl.replace(/\/$/, ''),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(apiKey && { 'Authorization': `Bearer ${apiKey}` })
      },
      timeout: 5000
    });
  }

  async createLink(link: GoLink): Promise<GoLink> {
    try {
      const response = await this.client.post('/api/v1/links', link);
      console.log(`✅ Created GoLink: go/${link.keyword} -> ${link.url}`);
      return response.data;
    } catch (error) {
      if (error.response?.status === 409) {
        console.log(`📋 GoLink go/${link.keyword} already exists, updating...`);
        return await this.updateLink(link.keyword, link);
      }
      throw new Error(`Failed to create GoLink: ${error.message}`);
    }
  }

  async updateLink(keyword: string, updates: Partial<GoLink>): Promise<GoLink> {
    const response = await this.client.patch(`/api/v1/links/${keyword}`, updates);
    console.log(`✅ Updated GoLink: go/${keyword}`);
    return response.data;
  }

  async deleteLink(keyword: string): Promise<void> {
    await this.client.delete(`/api/v1/links/${keyword}`);
    console.log(`✅ Deleted GoLink: go/${keyword}`);
  }

  async listLinks(): Promise<GoLink[]> {
    const response = await this.client.get('/api/v1/links');
    return response.data.links || [];
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/health');
      return response.status === 200;
    } catch {
      return false;
    }
  }

  // Bulk create homelab shortcuts
  async createHomelabShortcuts(domain: string): Promise<void> {
    const shortcuts: GoLink[] = [
      { keyword: 'pve', url: `https://pve.${domain}`, description: 'Proxmox VE Web UI' },
      { keyword: 'netbox', url: `https://netbox.${domain}`, description: 'Network Inventory' },
      { keyword: 'grafana', url: `https://grafana.${domain}`, description: 'Monitoring Dashboard' },
      { keyword: 'prometheus', url: `https://prometheus.${domain}`, description: 'Metrics Collection' },
      { keyword: 'adguard', url: `https://adguard.${domain}`, description: 'DNS Filter' },
      { keyword: 'homepage', url: `https://homepage.${domain}`, description: 'Service Dashboard' },
      { keyword: 'setec', url: `https://setec.${domain}`, description: 'Secrets Management' },
      { keyword: 'ca', url: `https://ca.${domain}`, description: 'Certificate Authority' },
      { keyword: 'yunohost', url: `https://yunohost.${domain}`, description: 'YunoHost Platform' },
      { keyword: 'olares', url: `https://olares.${domain}`, description: 'Olares Cloud OS' },
      { keyword: 'casaos', url: `https://casaos.${domain}`, description: 'CasaOS Platform' },
      { keyword: 'idrac-r240', url: `https://idrac-r240.${domain}`, description: 'R240 iDRAC' },
      { keyword: 'idrac-r7910', url: `https://idrac-r7910.${domain}`, description: 'R7910 iDRAC' },
      { keyword: 'gateway', url: `https://gateway.${domain}`, description: 'Pangolin Gateway' },
      { keyword: 'ssh', url: `https://ssh.${domain}`, description: 'SSH Web Terminal' },
      { keyword: 'api', url: `https://api.${domain}`, description: 'MCP API Endpoint' },
      { keyword: 'tailscale', url: 'https://login.tailscale.com/admin', description: 'Tailscale Admin' },
      { keyword: 'cloudflare', url: 'https://dash.cloudflare.com', description: 'Cloudflare Dashboard' },
      { keyword: 'homelab', url: `https://homepage.${domain}`, description: 'Complete Homelab Dashboard' }
    ];

    const results = await Promise.allSettled(
      shortcuts.map(shortcut => this.createLink(shortcut))
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    console.log(`✅ Created ${successful} GoLink shortcuts${failed > 0 ? `, ${failed} failed` : ''}`);
  }
}