/**
 * Settings and Configuration Manager
 * Centralized configuration management for homelab orchestrator
 * Related to issue #1 - Complete Homelab Orchestrator
 */

export interface HomelabConfig {
  environment: 'development' | 'staging' | 'production';
  services: ServiceConfig[];
  networking: NetworkConfig;
  monitoring: MonitoringConfig;
}

export interface ServiceConfig {
  name: string;
  enabled: boolean;
  port?: number;
  dependencies?: string[];
}

export interface NetworkConfig {
  domain: string;
  tailscaleKey?: string;
  cloudflareEnabled: boolean;
}

export interface MonitoringConfig {
  metricsEnabled: boolean;
  loggingLevel: 'debug' | 'info' | 'warn' | 'error';
  alertsEnabled: boolean;
}

export class SettingsManager {
  private config: HomelabConfig;

  constructor(initialConfig: Partial<HomelabConfig>) {
    this.config = this.mergeWithDefaults(initialConfig);
  }

  private mergeWithDefaults(config: Partial<HomelabConfig>): HomelabConfig {
    return {
      environment: config.environment || 'development',
      services: config.services || [],
      networking: config.networking || {
        domain: 'homelab.local',
        cloudflareEnabled: false
      },
      monitoring: config.monitoring || {
        metricsEnabled: true,
        loggingLevel: 'info',
        alertsEnabled: false
      }
    };
  }

  getConfig(): HomelabConfig {
    return this.config;
  }

  updateConfig(updates: Partial<HomelabConfig>): void {
    this.config = { ...this.config, ...updates };
  }
}
