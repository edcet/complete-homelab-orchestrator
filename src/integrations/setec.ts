import axios, { AxiosInstance } from "axios";

export interface SetecSecret {
  key: string;
  value: string;
  metadata?: Record<string, any>;
}

export class SetecClient {
  private client: AxiosInstance;
  private baseUrl: string;
  
  constructor(baseUrl: string, token?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` })
      },
      timeout: 5000
    });
  }

  async putSecret(key: string, value: string): Promise<void> {
    await this.client.put(`/api/v1/secrets/${key}`, value, {
      headers: { 'Content-Type': 'text/plain' }
    });
    console.log(`✅ Stored secret: ${key}`);
  }

  async getSecret(key: string): Promise<string> {
    const response = await this.client.get(`/api/v1/secrets/${key}`);
    return response.data;
  }

  async deleteSecret(key: string): Promise<void> {
    await this.client.delete(`/api/v1/secrets/${key}`);
    console.log(`✅ Deleted secret: ${key}`);
  }

  async listSecrets(): Promise<string[]> {
    const response = await this.client.get('/api/v1/secrets');
    return response.data.keys || [];
  }

  // Bulk secret management for homelab bootstrap
  async storeHomelabSecrets(secrets: Record<string, string>): Promise<void> {
    const operations = Object.entries(secrets).map(([key, value]) => 
      this.putSecret(key, value).catch(error => 
        console.warn(`⚠️ Failed to store ${key}: ${error.message}`)
      )
    );
    
    await Promise.allSettled(operations);
    console.log(`✅ Attempted to store ${Object.keys(secrets).length} secrets`);
  }

  async getHomelabSecrets(): Promise<Record<string, string>> {
    const keys = await this.listSecrets();
    const homelabKeys = keys.filter(key => 
      key.startsWith('homelab/') || 
      key.startsWith('cloudflare/') || 
      key.startsWith('tailscale/') ||
      key.startsWith('proxmox/') ||
      key.startsWith('idrac/')
    );
    
    const secrets: Record<string, string> = {};
    
    for (const key of homelabKeys) {
      try {
        secrets[key] = await this.getSecret(key);
      } catch (error) {
        console.warn(`⚠️ Failed to retrieve ${key}: ${error.message}`);
      }
    }
    
    return secrets;
  }

  async rotateSecret(key: string, newValue: string): Promise<void> {
    await this.putSecret(key, newValue);
    console.log(`🔄 Rotated secret: ${key}`);
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.get('/health');
      return true;
    } catch {
      return false;
    }
  }
}

export class ACMEDNSProvider {
  private cloudflare: CloudflareClient;
  private setec: SetecClient;
  
  constructor(cloudflare: CloudflareClient, setec: SetecClient) {
    this.cloudflare = cloudflare;
    this.setec = setec;
  }

  async handleChallenge(domain: string, token: string): Promise<void> {
    const txtRecordName = `_acme-challenge.${domain}`;
    
    console.log(`🔐 Creating ACME challenge TXT record: ${txtRecordName}`);
    
    await this.cloudflare.createDNSRecord({
      type: "TXT",
      name: txtRecordName,
      content: token,
      ttl: 120 // Short TTL for challenges
    });
    
    // Wait for DNS propagation
    await new Promise(resolve => setTimeout(resolve, 10000));
  }

  async cleanupChallenge(domain: string): Promise<void> {
    const txtRecordName = `_acme-challenge.${domain}`;
    
    try {
      const record = await this.cloudflare.getDNSRecordByName(txtRecordName);
      if (record.id) {
        await this.cloudflare.deleteDNSRecord(record.id);
        console.log(`✅ Cleaned up ACME challenge record: ${txtRecordName}`);
      }
    } catch (error) {
      console.warn(`⚠️ Failed to cleanup ACME challenge: ${error.message}`);
    }
  }

  async issueCertificate(domain: string): Promise<{ cert: string; key: string }> {
    console.log(`📜 Issuing certificate for: ${domain}`);
    
    // This would integrate with acme.sh or similar ACME client
    // to automatically issue certificates using DNS-01 challenge
    
    // For now, return placeholder
    return {
      cert: "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----",
      key: "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
    };
  }
}