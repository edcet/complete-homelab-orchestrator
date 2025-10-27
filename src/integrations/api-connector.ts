/**
 * API Integration Connector
 * Manages external service integrations for homelab
 * Related to issue #1 - Complete Homelab Orchestrator
 */

export interface IntegrationConfig {
  name: string;
  apiKey?: string;
  endpoint: string;
  enabled: boolean;
  timeout?: number;
}

export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: Date;
}

export class APIConnector {
  private integrations: Map<string, IntegrationConfig> = new Map();

  registerIntegration(config: IntegrationConfig): void {
    this.integrations.set(config.name, config);
  }

  async callAPI<T = any>(integrationName: string, path: string, options?: RequestInit): Promise<APIResponse<T>> {
    const integration = this.integrations.get(integrationName);
    
    if (!integration) {
      return {
        success: false,
        error: `Integration '${integrationName}' not found`,
        timestamp: new Date()
      };
    }

    if (!integration.enabled) {
      return {
        success: false,
        error: `Integration '${integrationName}' is disabled`,
        timestamp: new Date()
      };
    }

    try {
      const url = `${integration.endpoint}${path}`;
      const headers = {
        'Content-Type': 'application/json',
        ...(integration.apiKey && { 'Authorization': `Bearer ${integration.apiKey}` }),
        ...(options?.headers || {})
      };

      const response = await fetch(url, {
        ...options,
        headers,
        signal: AbortSignal.timeout(integration.timeout || 30000)
      });

      const data = await response.json();

      return {
        success: response.ok,
        data,
        timestamp: new Date()
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date()
      };
    }
  }

  listIntegrations(): IntegrationConfig[] {
    return Array.from(this.integrations.values());
  }

  removeIntegration(name: string): boolean {
    return this.integrations.delete(name);
  }
}
