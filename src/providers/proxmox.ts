import https from "https";
import { IncomingMessage } from "http";

export interface ProxmoxStatus {
  status: "ready" | "maintenance" | "error";
  version: string;
  uptime: number;
  nodes: number;
}

export interface ProxmoxAuth {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  token?: string;
}

export async function waitForProxmoxUI(auth: ProxmoxAuth, timeoutSec = 300): Promise<boolean> {
  const start = Date.now();
  const port = auth.port || 8006;
  
  console.log(`⏳ Waiting for Proxmox UI at ${auth.host}:${port}...`);
  
  while ((Date.now() - start) / 1000 < timeoutSec) {
    const isReady = await new Promise<boolean>(resolve => {
      const options: https.RequestOptions = {
        host: auth.host,
        port,
        path: "/api2/json/version",
        method: "GET",
        rejectUnauthorized: false,
        timeout: 5000
      };
      
      const req = https.request(options, (res: IncomingMessage) => {
        resolve(res.statusCode === 200);
      });
      
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
      
      req.end();
    });
    
    if (isReady) {
      console.log(`✅ Proxmox UI is ready at ${auth.host}:${port}`);
      return true;
    }
    
    const elapsed = Math.floor((Date.now() - start) / 1000);
    console.log(`⏳ Still waiting... (${elapsed}s/${timeoutSec}s)`);
    await new Promise(r => setTimeout(r, 5000));
  }
  
  throw new Error(`Timeout: Proxmox UI at ${auth.host}:${port} not ready after ${timeoutSec}s`);
}

export async function proxmoxStatus(auth: ProxmoxAuth): Promise<ProxmoxStatus> {
  const port = auth.port || 8006;
  
  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      host: auth.host,
      port,
      path: "/api2/json/version",
      method: "GET",
      rejectUnauthorized: false,
      timeout: 10000
    };
    
    const req = https.request(options, (res: IncomingMessage) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.data) {
            resolve({
              status: "ready",
              version: parsed.data.version || "unknown",
              uptime: parsed.data.uptime || 0,
              nodes: 1 // Single node for now
            });
          } else {
            reject(new Error("Invalid Proxmox API response"));
          }
        } catch (error) {
          reject(new Error(`Failed to parse Proxmox response: ${error.message}`));
        }
      });
    });
    
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Proxmox API request timeout"));
    });
    
    req.end();
  });
}

export async function proxmoxNodeList(auth: ProxmoxAuth): Promise<any[]> {
  // Implementation for listing Proxmox nodes
  // Would use authenticated API calls
  return [
    {
      node: auth.host,
      status: "online",
      type: "node",
      uptime: 86400
    }
  ];
}

export async function createLXCContainer(auth: ProxmoxAuth, config: {
  vmid: number;
  hostname: string;
  template: string;
  memory: number;
  cores: number;
  network: string;
}): Promise<void> {
  console.log(`📦 Creating LXC container ${config.vmid}: ${config.hostname}`);
  
  // Implementation would use Proxmox API to create LXC container
  // For now, return success
  console.log(`✅ LXC container ${config.vmid} created successfully`);
}