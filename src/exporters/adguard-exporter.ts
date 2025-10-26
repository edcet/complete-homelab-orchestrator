import * as docker from '@pulumi/docker';
import * as command from '@pulumi/command';
import { ComponentResource } from '@pulumi/pulumi';
import { AdGuardHomeClient } from '../integrations/adguard';
import { TailscaleClient } from '../integrations/tailscale';
import { PrometheusServiceDiscovery } from '../integrations/prometheus-sd';
import { HomelabConfig } from '../types/schemas';

export interface AdGuardExporterConfig {
  adguardEndpoint: string;
  prometheusPort: number;
  scrapeInterval: string;
  healthCheckInterval: string;
}

export class AdGuardExporter {
  private config: HomelabConfig;
  private adguard: AdGuardHomeClient;
  private tailscale: TailscaleClient;
  private prometheus: PrometheusServiceDiscovery;
  private parent: ComponentResource;
  
  constructor(
    config: HomelabConfig,
    adguard: AdGuardHomeClient,
    tailscale: TailscaleClient,
    prometheus: PrometheusServiceDiscovery,
    parent: ComponentResource
  ) {
    this.config = config;
    this.adguard = adguard;
    this.tailscale = tailscale;
    this.prometheus = prometheus;
    this.parent = parent;
  }

  public deployExporter(network: docker.Network): docker.Container {
    console.log('📊 Deploying AdGuard metrics exporter...');
    
    // Create exporter configuration
    const exporterConfig = new command.local.Command('adguard-exporter-config', {
      create: `
        mkdir -p /tmp/adguard-exporter
        cat > /tmp/adguard-exporter/config.yaml << 'EOF'
adguard_protocol: "http"
adguard_hostname: "adguard"
adguard_port: ${this.config.services.adguard.web_port}
adguard_username: "admin"
adguard_password: "${process.env.ADGUARD_PASSWORD || 'admin'}"
interval: 30s
log_level: info
metrics:
  enabled: true
  port: 9617
  path: /metrics
health_checks:
  dns_queries: true
  blocked_queries: true
  client_stats: true
  filter_stats: true
EOF
      `
    }, { parent: this.parent });

    return new docker.Container('adguard-exporter', {
      image: 'henrywhitaker3/adguard-exporter:latest',
      restart: 'unless-stopped',
      ports: [{ internal: 9617, external: 9617 }],
      envs: [
        'ADGUARD_PROTOCOL=http',
        'ADGUARD_HOSTNAME=adguard',
        `ADGUARD_PORT=${this.config.services.adguard.web_port}`,
        'ADGUARD_USERNAME=admin',
        `ADGUARD_PASSWORD=${process.env.ADGUARD_PASSWORD || 'admin'}`,
        'INTERVAL=30s',
        'LOG_LEVEL=info',
        'METRICS_ENABLED=true'
      ],
      volumes: [
        { hostPath: '/tmp/adguard-exporter', containerPath: '/app/config' }
      ],
      networksAdvanced: [{
        name: network.name,
        aliases: ['adguard-exporter', 'adguard-metrics']
      }],
      labels: {
        'prometheus.scrape': 'true',
        'prometheus.port': '9617',
        'prometheus.path': '/metrics',
        'prometheus.interval': '30s',
        'homelab.service': 'adguard-exporter',
        'homelab.role': 'monitoring',
        'homelab.component': 'dns-metrics'
      },
      healthcheck: {
        test: ['CMD', 'wget', '--no-verbose', '--tries=1', '--spider', 'http://localhost:9617/metrics'],
        interval: '30s',
        timeout: '10s',
        retries: 3,
        startPeriod: '30s'
      },
      dependsOn: [exporterConfig]
    }, { parent: this.parent });
  }

  public async syncClientsFromTailscale(): Promise<void> {
    console.log('🔄 Syncing AdGuard clients from Tailscale mesh...');
    
    try {
      const tailscaleDevices = await this.tailscale.getDevices();
      const existingClients = await this.adguard.getClients();
      const existingClientIPs = new Set(
        existingClients.flatMap(client => client.ids || [])
      );
      
      let addedCount = 0;
      let skippedCount = 0;
      
      for (const device of tailscaleDevices) {
        const deviceName = device.name || device.hostname || 'Unknown';
        
        for (const address of device.addresses) {
          if (existingClientIPs.has(address)) {
            skippedCount++;
            continue;
          }
          
          if (this.shouldManageDevice(address, device)) {
            try {
              await this.adguard.addClient({
                name: `${deviceName} (Tailscale)`,
                ids: [address],
                tags: this.generateClientTags(device),
                blocked_services: this.getBlockedServices(device),
                upstreams: this.getUpstreamDNS(device),
                use_global_settings: true,
                filtering_enabled: true,
                parental_enabled: false,
                safebrowsing_enabled: true,
                safesearch_enabled: false
              });
              
              console.log(`✅ Added AdGuard client: ${deviceName} (${address})`);
              addedCount++;
            } catch (error) {
              console.warn(`⚠️ Failed to add client ${deviceName} (${address}): ${error.message}`);
            }
          } else {
            skippedCount++;
          }
        }
      }
      
      console.log(`✅ Tailscale client sync complete: ${addedCount} added, ${skippedCount} skipped`);
    } catch (error) {
      console.error(`❌ Tailscale client sync failed: ${error.message}`);
      throw error;
    }
  }

  private shouldManageDevice(ip: string, device: any): boolean {
    // Only manage devices with homelab tags or in homelab subnet
    const hasHomelabTag = device.tags?.some((tag: string) => 
      tag.startsWith('tag:homelab') || tag.startsWith('tag:infrastructure')
    );
    
    const isHomelabIP = this.isInHomelabSubnet(ip);
    
    return hasHomelabTag || isHomelabIP;
  }

  private isInHomelabSubnet(ip: string): boolean {
    const subnet = this.config.networks.primary_subnet;
    const [network, mask] = subnet.split('/');
    const networkParts = network.split('.').map(Number);
    const ipParts = ip.split('.').map(Number);
    
    // Simple /24 subnet check
    if (mask === '24') {
      return networkParts.slice(0, 3).every((part, i) => part === ipParts[i]);
    }
    
    return false;
  }

  private generateClientTags(device: any): string[] {
    const tags = ['tailscale'];
    
    if (device.tags) {
      device.tags.forEach((tag: string) => {
        // Convert Tailscale tags to AdGuard tags
        if (tag.startsWith('tag:')) {
          tags.push(tag.replace('tag:', ''));
        }
      });
    }
    
    // Add device type tags
    if (device.os) {
      tags.push(device.os.toLowerCase());
    }
    
    return tags;
  }

  private getBlockedServices(device: any): string[] {
    // Block certain services based on device tags
    const blockedServices: string[] = [];
    
    if (device.tags?.includes('tag:child-device')) {
      blockedServices.push('youtube', 'tiktok', 'instagram');
    }
    
    if (device.tags?.includes('tag:iot')) {
      blockedServices.push('social_networks', 'gaming');
    }
    
    return blockedServices;
  }

  private getUpstreamDNS(device: any): string[] {
    // Different upstream DNS based on device type
    if (device.tags?.includes('tag:infrastructure')) {
      // Infrastructure devices use Cloudflare
      return ['1.1.1.1', '1.0.0.1'];
    }
    
    if (device.tags?.includes('tag:gaming')) {
      // Gaming devices use Google DNS for lower latency
      return ['8.8.8.8', '8.8.4.4'];
    }
    
    // Default: use global settings
    return [];
  }

  public async generatePrometheusConfig(): Promise<void> {
    console.log('📊 Generating Prometheus configuration for AdGuard...');
    
    const job = {
      job: 'adguard-metrics',
      targets: [{
        targets: ['adguard-exporter:9617'],
        labels: {
          service: 'adguard',
          role: 'dns-filter',
          instance: 'primary',
          component: 'homelab-dns'
        }
      }]
    };
    
    await this.prometheus.writeTargets([job]);
    console.log('✅ AdGuard Prometheus configuration generated');
  }

  public async getMetrics(): Promise<any> {
    try {
      const response = await fetch('http://localhost:9617/metrics');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const metrics = await response.text();
      return {
        healthy: true,
        metrics_available: true,
        last_scrape: new Date().toISOString(),
        metrics_count: metrics.split('\n').filter(line => 
          line.startsWith('adguard_') && !line.startsWith('#')
        ).length
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
        last_scrape: new Date().toISOString()
      };
    }
  }

  public async getClientSyncStatus(): Promise<any> {
    try {
      const [tailscaleDevices, adguardClients] = await Promise.all([
        this.tailscale.getDevices(),
        this.adguard.getClients()
      ]);
      
      const tailscaleIPs = new Set(
        tailscaleDevices.flatMap(d => d.addresses)
      );
      
      const managedClients = adguardClients.filter(client => 
        client.tags?.includes('tailscale')
      );
      
      const syncedCount = managedClients.filter(client => 
        client.ids.some(ip => tailscaleIPs.has(ip))
      ).length;
      
      return {
        tailscale_devices: tailscaleDevices.length,
        adguard_clients: adguardClients.length,
        managed_clients: managedClients.length,
        synced_clients: syncedCount,
        sync_ratio: managedClients.length > 0 ? syncedCount / managedClients.length : 0,
        last_sync: new Date().toISOString()
      };
    } catch (error) {
      return {
        error: error.message,
        last_sync: new Date().toISOString()
      };
    }
  }

  public async healthCheck(): Promise<boolean> {
    try {
      const [adguardHealth, exporterHealth] = await Promise.all([
        this.adguard.healthCheck(),
        fetch('http://localhost:9617/metrics').then(r => r.ok)
      ]);
      
      return adguardHealth && exporterHealth;
    } catch {
      return false;
    }
  }
}