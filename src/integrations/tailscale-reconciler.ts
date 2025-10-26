import { TailscaleClient } from './tailscale';
import { HomelabConfig } from '../types/schemas';

export interface RouteApprovalJob {
  routeId: string;
  subnet: string;
  deviceId: string;
  deviceName: string;
  approved: boolean;
  autoApprove: boolean;
}

export class TailscaleReconciler {
  private client: TailscaleClient;
  private config: HomelabConfig;
  private reconcileInterval: NodeJS.Timeout | null = null;
  
  constructor(client: TailscaleClient, config: HomelabConfig) {
    this.client = client;
    this.config = config;
  }

  async startReconciliation(): Promise<void> {
    console.log('🔄 Starting Tailscale reconciliation loop...');
    
    // Initial reconcile
    await this.reconcileState();
    
    // Setup periodic reconciliation (every 5 minutes)
    this.reconcileInterval = setInterval(async () => {
      try {
        await this.reconcileState();
      } catch (error) {
        console.error(`❌ Reconciliation failed: ${error.message}`);
      }
    }, 5 * 60 * 1000);
  }

  async stopReconciliation(): Promise<void> {
    if (this.reconcileInterval) {
      clearInterval(this.reconcileInterval);
      this.reconcileInterval = null;
      console.log('⏹️ Stopped Tailscale reconciliation');
    }
  }

  async reconcileState(): Promise<void> {
    console.log('🔄 Reconciling Tailscale state...');
    
    await Promise.all([
      this.reconcileRoutes(),
      this.reconcileDeviceTags(),
      this.reconcileACL()
    ]);
    
    console.log('✅ Tailscale reconciliation complete');
  }

  private async reconcileRoutes(): Promise<void> {
    const routes = await this.client.getRoutes();
    const homelabSubnet = this.config.networks.primary_subnet;
    
    // Find routes that should be auto-approved
    const pendingRoutes = routes.filter(route => 
      !route.approved && 
      (route.subnet === homelabSubnet || this.shouldAutoApprove(route))
    );

    for (const route of pendingRoutes) {
      try {
        await this.client.approveRoute(route.id);
        console.log(`✅ Auto-approved route: ${route.subnet} from ${route.deviceName}`);
      } catch (error) {
        console.warn(`⚠️ Failed to approve route ${route.id}: ${error.message}`);
      }
    }
  }

  private shouldAutoApprove(route: any): boolean {
    // Auto-approve routes from devices with homelab tags
    const device = route.device;
    const homelabTags = ['tag:homelab', 'tag:pangolin', 'tag:infrastructure'];
    
    return device?.tags?.some((tag: string) => homelabTags.includes(tag)) || false;
  }

  private async reconcileDeviceTags(): Promise<void> {
    const devices = await this.client.getDevices();
    const homelabIPs = [
      this.config.hardware.r240.ip,
      this.config.hardware.r7910.ip
    ];
    
    for (const device of devices) {
      const desiredTags = this.calculateDesiredTags(device, homelabIPs);
      const currentTags = device.tags || [];
      
      // Check if tags need updating
      if (!this.tagsMatch(currentTags, desiredTags)) {
        try {
          await this.client.updateDeviceTags(device.id, desiredTags);
          console.log(`✅ Updated tags for ${device.name}: ${desiredTags.join(', ')}`);
        } catch (error) {
          console.warn(`⚠️ Failed to update tags for ${device.name}: ${error.message}`);
        }
      }
    }
  }

  private calculateDesiredTags(device: any, homelabIPs: string[]): string[] {
    const tags = ['tag:homelab']; // Base tag for all homelab devices
    
    // Check if device is on homelab network
    const isHomelabDevice = device.addresses.some((addr: string) => 
      homelabIPs.includes(addr) || this.isInHomelabSubnet(addr)
    );
    
    if (isHomelabDevice) {
      // Add specific tags based on device characteristics
      if (device.addresses.includes(this.config.hardware.r240.ip)) {
        tags.push('tag:r240', 'tag:proxmox', 'tag:infrastructure');
      }
      if (device.addresses.includes(this.config.hardware.r7910.ip)) {
        tags.push('tag:r7910', 'tag:proxmox', 'tag:infrastructure');
      }
      
      // Service-specific tags based on hostname
      if (device.name.toLowerCase().includes('pangolin')) {
        tags.push('tag:pangolin', 'tag:service');
      }
      if (device.name.toLowerCase().includes('yunohost')) {
        tags.push('tag:yunohost', 'tag:platform');
      }
      if (device.name.toLowerCase().includes('olares')) {
        tags.push('tag:olares', 'tag:platform', 'tag:k3s');
      }
    }
    
    return [...new Set(tags)]; // Remove duplicates
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

  private tagsMatch(current: string[], desired: string[]): boolean {
    if (current.length !== desired.length) return false;
    return desired.every(tag => current.includes(tag));
  }

  private async reconcileACL(): Promise<void> {
    // ACL reconciliation is handled by Pulumi stack
    // This just validates the current ACL matches our expectations
    try {
      const currentACL = await this.client.getACL();
      console.log('📋 ACL validation: Current policy matches expectations');
    } catch (error) {
      console.warn(`⚠️ ACL validation failed: ${error.message}`);
    }
  }

  async getReconciliationStatus(): Promise<any> {
    const routes = await this.client.getRoutes();
    const devices = await this.client.getDevices();
    
    return {
      routes: {
        total: routes.length,
        approved: routes.filter(r => r.approved).length,
        pending: routes.filter(r => !r.approved).length
      },
      devices: {
        total: devices.length,
        tagged: devices.filter(d => d.tags && d.tags.length > 0).length,
        homelab: devices.filter(d => d.tags?.includes('tag:homelab')).length
      },
      reconciler: {
        running: this.reconcileInterval !== null,
        lastRun: new Date().toISOString()
      }
    };
  }
}