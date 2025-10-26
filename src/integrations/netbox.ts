import axios, { AxiosInstance } from "axios";

export interface NetBoxDevice {
  id?: number;
  name: string;
  device_type: number | string;
  device_role: number | string;
  site: number | string;
  rack?: number | string;
  primary_ip4?: string;
  primary_ip6?: string;
  platform?: number | string;
  serial?: string;
  asset_tag?: string;
  status?: "active" | "offline" | "planned" | "staged" | "failed" | "decommissioning";
  tags?: string[];
  custom_fields?: Record<string, any>;
}

export interface NetBoxSite {
  id?: number;
  name: string;
  slug: string;
  status?: "active" | "planned" | "retired";
  facility?: string;
  description?: string;
  physical_address?: string;
  tags?: string[];
}

export interface NetBoxRack {
  id?: number;
  name: string;
  site: number | string;
  status?: "reserved" | "available" | "planned" | "active" | "deprecated";
  role?: number | string;
  serial?: string;
  asset_tag?: string;
  type?: "2-post-frame" | "4-post-frame" | "4-post-cabinet" | "wall-frame" | "wall-cabinet";
  width?: 19 | 23;
  u_height?: number;
  desc_units?: boolean;
  tags?: string[];
}

export class NetBoxClient {
  private client: AxiosInstance;
  private baseUrl: string;
  
  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Authorization': `Token ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 10000
    });
  }

  // Site management
  async createSite(site: NetBoxSite): Promise<NetBoxSite> {
    try {
      const response = await this.client.post('/api/dcim/sites/', site);
      console.log(`✅ Created NetBox site: ${site.name}`);
      return response.data;
    } catch (error) {
      if (error.response?.status === 400 && error.response.data?.name?.[0]?.includes('already exists')) {
        console.log(`📋 Site ${site.name} already exists, fetching...`);
        return await this.getSiteByName(site.name);
      }
      throw new Error(`Failed to create site: ${error.message}`);
    }
  }

  async getSiteByName(name: string): Promise<NetBoxSite> {
    const response = await this.client.get(`/api/dcim/sites/?name=${encodeURIComponent(name)}`);
    if (response.data.results?.length > 0) {
      return response.data.results[0];
    }
    throw new Error(`Site not found: ${name}`);
  }

  // Rack management  
  async createRack(rack: NetBoxRack): Promise<NetBoxRack> {
    try {
      const response = await this.client.post('/api/dcim/racks/', rack);
      console.log(`✅ Created NetBox rack: ${rack.name}`);
      return response.data;
    } catch (error) {
      if (error.response?.status === 400) {
        console.log(`📋 Rack ${rack.name} may already exist`);
        return rack; // Return input for idempotency
      }
      throw new Error(`Failed to create rack: ${error.message}`);
    }
  }

  // Device management
  async createOrUpdateDevice(device: NetBoxDevice): Promise<NetBoxDevice> {
    try {
      // Try to find existing device first
      const existing = await this.getDeviceByName(device.name);
      if (existing) {
        console.log(`📋 Updating existing device: ${device.name}`);
        const response = await this.client.patch(`/api/dcim/devices/${existing.id}/`, device);
        return response.data;
      }
    } catch (error) {
      // Device doesn't exist, create new
    }

    try {
      const response = await this.client.post('/api/dcim/devices/', device);
      console.log(`✅ Created NetBox device: ${device.name}`);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to create/update device: ${error.message}`);
    }
  }

  async getDeviceByName(name: string): Promise<NetBoxDevice | null> {
    try {
      const response = await this.client.get(`/api/dcim/devices/?name=${encodeURIComponent(name)}`);
      return response.data.results?.[0] || null;
    } catch (error) {
      return null;
    }
  }

  // Device types and roles
  async ensureDeviceType(name: string, manufacturer: string): Promise<number> {
    try {
      const response = await this.client.get(`/api/dcim/device-types/?model=${encodeURIComponent(name)}`);
      if (response.data.results?.length > 0) {
        return response.data.results[0].id;
      }
      
      // Create device type
      const newType = await this.client.post('/api/dcim/device-types/', {
        model: name,
        manufacturer: await this.ensureManufacturer(manufacturer),
        slug: name.toLowerCase().replace(/[^a-z0-9-]/g, '-')
      });
      
      return newType.data.id;
    } catch (error) {
      throw new Error(`Failed to ensure device type: ${error.message}`);
    }
  }

  async ensureDeviceRole(name: string): Promise<number> {
    try {
      const response = await this.client.get(`/api/dcim/device-roles/?name=${encodeURIComponent(name)}`);
      if (response.data.results?.length > 0) {
        return response.data.results[0].id;
      }
      
      // Create device role
      const newRole = await this.client.post('/api/dcim/device-roles/', {
        name,
        slug: name.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        color: 'blue'
      });
      
      return newRole.data.id;
    } catch (error) {
      throw new Error(`Failed to ensure device role: ${error.message}`);
    }
  }

  private async ensureManufacturer(name: string): Promise<number> {
    try {
      const response = await this.client.get(`/api/dcim/manufacturers/?name=${encodeURIComponent(name)}`);
      if (response.data.results?.length > 0) {
        return response.data.results[0].id;
      }
      
      // Create manufacturer
      const newMfg = await this.client.post('/api/dcim/manufacturers/', {
        name,
        slug: name.toLowerCase().replace(/[^a-z0-9-]/g, '-')
      });
      
      return newMfg.data.id;
    } catch (error) {
      throw new Error(`Failed to ensure manufacturer: ${error.message}`);
    }
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/api/status/');
      return response.status === 200;
    } catch (error) {
      return false;
    }
  }
}

export async function registerDevice(netboxUrl: string, token: string, device: {
  name: string;
  ip: string;
  role: string;
  type?: string;
  manufacturer?: string;
  site?: string;
}): Promise<boolean> {
  const client = new NetBoxClient(netboxUrl, token);
  
  try {
    // Ensure site exists
    const siteName = device.site || 'Homelab';
    await client.createSite({
      name: siteName,
      slug: siteName.toLowerCase(),
      status: 'active'
    });
    
    // Ensure device type and role
    const deviceTypeId = await client.ensureDeviceType(device.type || 'Generic Server', device.manufacturer || 'Generic');
    const deviceRoleId = await client.ensureDeviceRole(device.role);
    const site = await client.getSiteByName(siteName);
    
    // Create/update device
    await client.createOrUpdateDevice({
      name: device.name,
      device_type: deviceTypeId,
      device_role: deviceRoleId,
      site: site.id!,
      primary_ip4: device.ip,
      status: 'active'
    });
    
    return true;
  } catch (error) {
    console.error(`❌ NetBox registration failed: ${error.message}`);
    return false;
  }
}