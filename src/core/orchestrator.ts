import { ComponentResource, ComponentResourceOptions, Output } from "@pulumi/pulumi";
import * as docker from "@pulumi/docker";
import * as cloudflare from "@pulumi/cloudflare";
import * as command from "@pulumi/command";
import { HomelabConfig, validateConfig } from '../types/schemas';
import { MCPServer } from '../mcp/server';
import { ServiceManager } from './service-manager';
import { IntegrationManager } from './integration-manager';
import { NetworkManager } from './network-manager';
import { SecurityManager } from './security-manager';

export class CompleteHomelabOrchestrator extends ComponentResource {
  public readonly serviceManager: ServiceManager;
  public readonly integrationManager: IntegrationManager;
  public readonly networkManager: NetworkManager;
  public readonly securityManager: SecurityManager;
  public readonly mcpServer: MCPServer;
  
  // Core infrastructure outputs
  public readonly pangolinGateway: docker.Container;
  public readonly newtTunnelClient: docker.Container;
  public readonly olmClientManager: docker.Container;
  public readonly cloudflaredTunnel: docker.Container;
  public readonly tailscaleMesh: command.local.Command;
  public readonly setecVault: docker.Container;
  public readonly stepCAServer: docker.Container;
  public readonly adguardDNS: docker.Container;
  public readonly homepageDashboard: docker.Container;
  
  // Platform services
  public readonly yunoHostVM: command.local.Command;
  public readonly olaresCluster: docker.Container;
  public readonly casaOSPlatform: docker.Container;
  
  // Network and discovery
  public readonly serviceDiscovery: docker.Container;
  public readonly ddnsUpdater: docker.Container;
  public readonly acmeDNSProvider: docker.Container;
  
  // Network infrastructure
  public readonly homelabNetwork: docker.Network;
  
  constructor(name: string, config: HomelabConfig, opts?: ComponentResourceOptions) {
    super("homelab:complete-orchestrator", name, {}, opts);
    
    // Validate configuration
    const validatedConfig = validateConfig(config);
    
    console.log(`🚀 Initializing Complete Homelab Orchestrator: ${name}`);
    console.log(`📊 Domain: ${validatedConfig.domain}`);
    console.log(`🔧 Services enabled: ${Object.entries(validatedConfig.services)
      .filter(([, service]) => service.enabled)
      .map(([name]) => name)
      .join(', ')}`);
    
    // Initialize managers
    this.networkManager = new NetworkManager(validatedConfig, this);
    this.securityManager = new SecurityManager(validatedConfig, this);
    this.serviceManager = new ServiceManager(validatedConfig, this);
    this.integrationManager = new IntegrationManager(validatedConfig, this);
    this.mcpServer = new MCPServer(validatedConfig, this);
    
    // Deploy infrastructure in order
    this.deployInfrastructure(validatedConfig);
  }
  
  private deployInfrastructure(config: HomelabConfig): void {
    // 1. Create network fabric
    this.homelabNetwork = this.networkManager.createNetwork();
    
    // 2. Deploy security layer first
    this.setecVault = this.securityManager.deploySetecVault(this.homelabNetwork);
    this.stepCAServer = this.securityManager.deployStepCA(this.homelabNetwork);
    this.acmeDNSProvider = this.securityManager.deployACMEProvider(this.homelabNetwork);
    
    // 3. Core Pangolin ecosystem
    this.pangolinGateway = this.serviceManager.deployPangolinGateway(this.homelabNetwork);
    this.newtTunnelClient = this.serviceManager.deployNewtClient(this.homelabNetwork);
    this.olmClientManager = this.serviceManager.deployOlmManager(this.homelabNetwork);
    
    // 4. Network infrastructure
    this.cloudflaredTunnel = this.networkManager.deployCloudflaredTunnel(this.homelabNetwork);
    this.tailscaleMesh = this.networkManager.configureTailscaleMesh();
    this.ddnsUpdater = this.networkManager.deployDDNSUpdater(this.homelabNetwork);
    this.adguardDNS = this.networkManager.deployAdGuardHome(this.homelabNetwork);
    
    // 5. Platform services
    this.yunoHostVM = this.serviceManager.deployYunoHost();
    this.olaresCluster = this.serviceManager.deployOlares(this.homelabNetwork);
    this.casaOSPlatform = this.serviceManager.deployCasaOS(this.homelabNetwork);
    
    // 6. Service discovery and monitoring
    this.serviceDiscovery = this.integrationManager.deployServiceDiscovery(this.homelabNetwork);
    this.homepageDashboard = this.serviceManager.deployHomepageDashboard(this.homelabNetwork);
    
    // 7. Setup integrations
    this.integrationManager.setupIntegrations();
    
    // 8. Start MCP server
    this.mcpServer.initialize();
    
    this.registerOutputs({
      pangolinEndpoint: this.pangolinGateway.name,
      tunnelId: this.cloudflaredTunnel.name,
      mcpEndpoint: config.networks.mcp_endpoint,
      tailscaleStatus: this.tailscaleMesh.stdout,
      setecVault: this.setecVault.name,
      stepCA: this.stepCAServer.name,
      networkId: this.homelabNetwork.id,
      servicesDiscovered: this.serviceDiscovery.name,
    });
  }
  
  public async getStatus(): Promise<any> {
    return {
      orchestrator: "active",
      timestamp: new Date().toISOString(),
      services: await this.serviceManager.getStatus(),
      integrations: await this.integrationManager.getStatus(),
      network: await this.networkManager.getStatus(),
      security: await this.securityManager.getStatus(),
      mcp: await this.mcpServer.getStatus(),
    };
  }
  
  public async healthCheck(): Promise<boolean> {
    try {
      const status = await this.getStatus();
      const criticalServices = [
        'pangolin', 'tailscale', 'cloudflared', 'setec'
      ];
      
      for (const service of criticalServices) {
        if (!status.services[service]?.healthy) {
          console.warn(`❌ Critical service ${service} unhealthy`);
          return false;
        }
      }
      
      console.log("✅ All critical services healthy");
      return true;
    } catch (error) {
      console.error(`❌ Health check failed: ${error}`);
      return false;
    }
  }
  
  public async destroy(): Promise<void> {
    console.log("🔄 Destroying homelab orchestrator...");
    
    // Stop MCP server first
    await this.mcpServer.stop();
    
    // Cleanup integrations
    await this.integrationManager.cleanup();
    
    // Destroy services
    await this.serviceManager.destroy();
    
    // Cleanup network and security
    await this.networkManager.cleanup();
    await this.securityManager.cleanup();
    
    console.log("✅ Homelab orchestrator destroyed");
  }
  
  // Utility methods for runtime operations
  public async restartService(serviceName: string): Promise<void> {
    console.log(`🔄 Restarting service: ${serviceName}`);
    await this.serviceManager.restartService(serviceName);
  }
  
  public async scaleService(serviceName: string, replicas: number): Promise<void> {
    console.log(`📈 Scaling service ${serviceName} to ${replicas} replicas`);
    await this.serviceManager.scaleService(serviceName, replicas);
  }
  
  public async updateConfiguration(newConfig: Partial<HomelabConfig>): Promise<void> {
    console.log("🔧 Updating homelab configuration...");
    await this.integrationManager.updateConfiguration(newConfig);
  }
  
  public async backup(): Promise<string> {
    console.log("💾 Creating homelab backup...");
    return await this.serviceManager.createBackup();
  }
  
  public async restore(backupId: string): Promise<void> {
    console.log(`🔄 Restoring from backup: ${backupId}`);
    await this.serviceManager.restoreFromBackup(backupId);
  }
  
  // Advanced operations
  public async deployApplication(appConfig: any): Promise<void> {
    console.log("🚀 Deploying application...");
    await this.serviceManager.deployApplication(appConfig);
  }
  
  public async migrateData(from: string, to: string): Promise<void> {
    console.log(`🔄 Migrating data from ${from} to ${to}`);
    await this.serviceManager.migrateData(from, to);
  }
  
  public async enableMaintenanceMode(): Promise<void> {
    console.log("🚧 Enabling maintenance mode...");
    await this.integrationManager.enableMaintenanceMode();
  }
  
  public async disableMaintenanceMode(): Promise<void> {
    console.log("✅ Disabling maintenance mode...");
    await this.integrationManager.disableMaintenanceMode();
  }
}