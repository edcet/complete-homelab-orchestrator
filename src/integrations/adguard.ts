import axios, { AxiosInstance } from "axios";

export interface AdGuardStats {
  time_units: string;
  top_queried_domains: Array<{ name: string; count: number }>;
  top_clients: Array<{ name: string; count: number }>;
  top_blocked_domains: Array<{ name: string; count: number }>;
  dns_queries: number[];
  blocked_filtering: number[];
  replaced_safebrowsing: number[];
  replaced_safesearch: number[];
  replaced_parental: number[];
  num_dns_queries: number;
  num_blocked_filtering: number;
  num_replaced_safebrowsing: number;
  num_replaced_safesearch: number;
  num_replaced_parental: number;
  avg_processing_time: number;
}

export interface AdGuardClient {
  name: string;
  ids: string[];
  tags: string[];
  blocked_services: string[];
  upstreams: string[];
  use_global_settings: boolean;
  filtering_enabled: boolean;
  parental_enabled: boolean;
  safebrowsing_enabled: boolean;
  safesearch_enabled: boolean;
}

export interface AdGuardDNSRewrite {
  domain: string;
  answer: string;
}

export class AdGuardHomeClient {
  private client: AxiosInstance;
  private baseUrl: string;
  
  constructor(baseUrl: string, username?: string, password?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    // Add basic auth if provided
    if (username && password) {
      this.client.defaults.auth = { username, password };
    }
  }

  async getStatus(): Promise<any> {
    const response = await this.client.get('/control/status');
    return response.data;
  }

  async getStats(): Promise<AdGuardStats> {
    const response = await this.client.get('/control/stats');
    return response.data;
  }

  // DNS rewrite rules for homelab services
  async setDNSRewrites(rewrites: AdGuardDNSRewrite[]): Promise<void> {
    // Get existing rewrites
    const existing = await this.client.get('/control/rewrite/list');
    const existingDomains = new Set(existing.data.map((r: any) => r.domain));
    
    for (const rewrite of rewrites) {
      if (existingDomains.has(rewrite.domain)) {
        console.log(`📋 DNS rewrite exists: ${rewrite.domain}`);
        continue;
      }
      
      try {
        await this.client.post('/control/rewrite/add', rewrite);
        console.log(`✅ Added DNS rewrite: ${rewrite.domain} -> ${rewrite.answer}`);
      } catch (error) {
        console.warn(`⚠️ Failed to add DNS rewrite for ${rewrite.domain}: ${error.message}`);
      }
    }
  }

  // Generate homelab DNS rewrites
  async setupHomelabDNS(domain: string, gatewayIP: string): Promise<void> {
    const homelabRewrites: AdGuardDNSRewrite[] = [
      { domain: `*.${domain}`, answer: gatewayIP },
      { domain: domain, answer: gatewayIP },
      { domain: `pve.${domain}`, answer: gatewayIP },
      { domain: `netbox.${domain}`, answer: gatewayIP },
      { domain: `grafana.${domain}`, answer: gatewayIP },
      { domain: `adguard.${domain}`, answer: gatewayIP },
      { domain: `homepage.${domain}`, answer: gatewayIP },
      { domain: `yunohost.${domain}`, answer: gatewayIP },
      { domain: `olares.${domain}`, answer: gatewayIP },
      { domain: `casaos.${domain}`, answer: gatewayIP },
      { domain: `setec.${domain}`, answer: gatewayIP },
      { domain: `ca.${domain}`, answer: gatewayIP },
      { domain: `ssh.${domain}`, answer: gatewayIP },
      { domain: `api.${domain}`, answer: gatewayIP }
    ];

    await this.setDNSRewrites(homelabRewrites);
    console.log(`✅ Setup ${homelabRewrites.length} homelab DNS rewrites`);
  }

  // Client management
  async addClient(client: AdGuardClient): Promise<void> {
    await this.client.post('/control/clients/add', client);
    console.log(`✅ Added AdGuard client: ${client.name}`);
  }

  async getClients(): Promise<AdGuardClient[]> {
    const response = await this.client.get('/control/clients');
    return response.data.clients || [];
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      const status = await this.getStatus();
      return status.running === true;
    } catch {
      return false;
    }
  }
}