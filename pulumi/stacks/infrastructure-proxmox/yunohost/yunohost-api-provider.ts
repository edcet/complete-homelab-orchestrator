/**
 * YunoHost API Dynamic Provider
 * 
 * This module implements a Pulumi dynamic provider for interacting with
 * YunoHost's REST API, enabling declarative app installation, configuration,
 * and management without remote bash commands.
 */

import * as pulumi from "@pulumi/pulumi";
import axios, { AxiosInstance } from "axios";
import * as https from "https";

export interface YunoHostAPIConfig {
  host: string;
  adminUser: string;
  adminPassword: pulumi.Output<string> | string;
  insecure?: boolean; // Allow self-signed certificates
}

export interface YunoHostAppInputs {
  host: string;
  apiKey: string;
  appName: string;
  domain: string;
  path?: string;
  label?: string;
  args?: Record<string, any>;
}

export interface YunoHostAppOutputs {
  id: string;
  name: string;
  domain: string;
  path: string;
  url: string;
  status: string;
  installed: boolean;
}

/**
 * YunoHost API Client
 */
class YunoHostAPIClient {
  private client: AxiosInstance;
  private apiKey?: string;
  
  constructor(config: YunoHostAPIConfig) {
    const password = typeof config.adminPassword === 'string' 
      ? config.adminPassword 
      : pulumi.output(config.adminPassword).apply(p => p);
    
    this.client = axios.create({
      baseURL: `https://${config.host}`,
      timeout: 30000,
      httpsAgent: new https.Agent({
        rejectUnauthorized: !config.insecure,
      }),
    });
  }
  
  async authenticate(user: string, password: string): Promise<string> {
    try {
      const response = await this.client.post('/yunohost/api/login', {
        username: user,
        password: password,
      });
      
      this.apiKey = response.data.token;
      return this.apiKey;
    } catch (error: any) {
      throw new Error(`YunoHost authentication failed: ${error.message}`);
    }
  }
  
  async installApp(inputs: YunoHostAppInputs): Promise<YunoHostAppOutputs> {
    try {
      const installData = {
        app: inputs.appName,
        domain: inputs.domain,
        path: inputs.path || '/',
        label: inputs.label || inputs.appName,
        args: inputs.args || {},
      };
      
      const response = await this.client.post(
        '/yunohost/api/apps/install',
        installData,
        {
          headers: {
            'Authorization': `Bearer ${inputs.apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );
      
      return {
        id: response.data.id || `${inputs.appName}-${Date.now()}`,
        name: inputs.appName,
        domain: inputs.domain,
        path: inputs.path || '/',
        url: `https://${inputs.domain}${inputs.path || '/'}`,
        status: 'installed',
        installed: true,
      };
    } catch (error: any) {
      throw new Error(`YunoHost app installation failed: ${error.message}`);
    }
  }
  
  async uninstallApp(appId: string, apiKey: string): Promise<void> {
    try {
      await this.client.delete(`/yunohost/api/apps/${appId}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });
    } catch (error: any) {
      throw new Error(`YunoHost app uninstallation failed: ${error.message}`);
    }
  }
  
  async getApp(appId: string, apiKey: string): Promise<YunoHostAppOutputs | null> {
    try {
      const response = await this.client.get(`/yunohost/api/apps/${appId}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });
      
      const app = response.data;
      return {
        id: app.id,
        name: app.name,
        domain: app.domain,
        path: app.path,
        url: app.url,
        status: app.status,
        installed: app.installed,
      };
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      throw new Error(`Failed to get YunoHost app: ${error.message}`);
    }
  }
  
  async configureSSO(domain: string, apiKey: string, config: Record<string, any>): Promise<void> {
    try {
      await this.client.post(
        '/yunohost/api/sso/configure',
        { domain, ...config },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
        }
      );
    } catch (error: any) {
      throw new Error(`YunoHost SSO configuration failed: ${error.message}`);
    }
  }
  
  async getLDAPConfig(apiKey: string): Promise<Record<string, any>> {
    try {
      const response = await this.client.get('/yunohost/api/ldap/config', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });
      
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to get LDAP config: ${error.message}`);
    }
  }
}

/**
 * Dynamic Provider for YunoHost Apps
 */
class YunoHostAppProvider implements pulumi.dynamic.ResourceProvider {
  private client: YunoHostAPIClient;
  
  constructor(config: YunoHostAPIConfig) {
    this.client = new YunoHostAPIClient(config);
  }
  
  async create(inputs: YunoHostAppInputs): Promise<pulumi.dynamic.CreateResult> {
    const outputs = await this.client.installApp(inputs);
    
    return {
      id: outputs.id,
      outs: outputs,
    };
  }
  
  async update(
    id: string,
    olds: YunoHostAppOutputs,
    news: YunoHostAppInputs
  ): Promise<pulumi.dynamic.UpdateResult> {
    // For updates, we need to uninstall and reinstall
    // In a real implementation, we'd use YunoHost's update API
    await this.client.uninstallApp(id, news.apiKey);
    const outputs = await this.client.installApp(news);
    
    return {
      outs: outputs,
    };
  }
  
  async delete(id: string, props: YunoHostAppOutputs): Promise<void> {
    // Extract apiKey from props (we'd need to store this)
    // For now, we'll assume it's available in the props
    const apiKey = (props as any).apiKey;
    if (apiKey) {
      await this.client.uninstallApp(id, apiKey);
    }
  }
  
  async read(id: string, props: YunoHostAppOutputs): Promise<pulumi.dynamic.ReadResult> {
    const apiKey = (props as any).apiKey;
    const app = await this.client.getApp(id, apiKey);
    
    if (!app) {
      return {
        id: undefined as any,
        props: undefined as any,
      };
    }
    
    return {
      id: app.id,
      props: app,
    };
  }
}

/**
 * YunoHost App Resource
 */
export class YunoHostApp extends pulumi.dynamic.Resource {
  public readonly name!: pulumi.Output<string>;
  public readonly domain!: pulumi.Output<string>;
  public readonly path!: pulumi.Output<string>;
  public readonly url!: pulumi.Output<string>;
  public readonly status!: pulumi.Output<string>;
  public readonly installed!: pulumi.Output<boolean>;
  
  constructor(
    name: string,
    args: YunoHostAppInputs,
    config: YunoHostAPIConfig,
    opts?: pulumi.CustomResourceOptions
  ) {
    const provider = new YunoHostAppProvider(config);
    
    super(
      provider,
      name,
      {
        name: undefined,
        domain: undefined,
        path: undefined,
        url: undefined,
        status: undefined,
        installed: undefined,
      },
      { ...opts, ...args }
    );
  }
}

/**
 * YunoHost SSO Configuration Resource
 */
export interface YunoHostSSOInputs {
  host: string;
  apiKey: string;
  domain: string;
  ldapDomain?: string;
  enableLDAP?: boolean;
  permissions?: Record<string, string[]>;
}

export interface YunoHostSSOOutputs {
  id: string;
  domain: string;
  ldapEnabled: boolean;
  ldapDomain?: string;
}

class YunoHostSSOProvider implements pulumi.dynamic.ResourceProvider {
  private client: YunoHostAPIClient;
  
  constructor(config: YunoHostAPIConfig) {
    this.client = new YunoHostAPIClient(config);
  }
  
  async create(inputs: YunoHostSSOInputs): Promise<pulumi.dynamic.CreateResult> {
    await this.client.configureSSO(inputs.domain, inputs.apiKey, {
      ldapDomain: inputs.ldapDomain,
      enableLDAP: inputs.enableLDAP,
      permissions: inputs.permissions,
    });
    
    const outputs: YunoHostSSOOutputs = {
      id: `sso-${inputs.domain}`,
      domain: inputs.domain,
      ldapEnabled: inputs.enableLDAP || false,
      ldapDomain: inputs.ldapDomain,
    };
    
    return {
      id: outputs.id,
      outs: outputs,
    };
  }
  
  async update(
    id: string,
    olds: YunoHostSSOOutputs,
    news: YunoHostSSOInputs
  ): Promise<pulumi.dynamic.UpdateResult> {
    await this.client.configureSSO(news.domain, news.apiKey, {
      ldapDomain: news.ldapDomain,
      enableLDAP: news.enableLDAP,
      permissions: news.permissions,
    });
    
    const outputs: YunoHostSSOOutputs = {
      id: `sso-${news.domain}`,
      domain: news.domain,
      ldapEnabled: news.enableLDAP || false,
      ldapDomain: news.ldapDomain,
    };
    
    return {
      outs: outputs,
    };
  }
  
  async delete(id: string, props: YunoHostSSOOutputs): Promise<void> {
    // SSO configuration typically shouldn't be deleted
    // but we can disable it if needed
  }
}

export class YunoHostSSO extends pulumi.dynamic.Resource {
  public readonly domain!: pulumi.Output<string>;
  public readonly ldapEnabled!: pulumi.Output<boolean>;
  public readonly ldapDomain!: pulumi.Output<string | undefined>;
  
  constructor(
    name: string,
    args: YunoHostSSOInputs,
    config: YunoHostAPIConfig,
    opts?: pulumi.CustomResourceOptions
  ) {
    const provider = new YunoHostSSOProvider(config);
    
    super(
      provider,
      name,
      {
        domain: undefined,
        ldapEnabled: undefined,
        ldapDomain: undefined,
      },
      { ...opts, ...args }
    );
  }
}

/**
 * Factory function for creating YunoHost API client
 */
export function createYunoHostAPIClient(config: YunoHostAPIConfig): YunoHostAPIClient {
  return new YunoHostAPIClient(config);
}
