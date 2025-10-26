import https from "https";
import { IncomingMessage } from "http";

export interface IDracPowerState {
  state: "On" | "Off" | "PoweringOn" | "PoweringOff";
  health: string;
}

export async function redfishReset(host: string, user: string, pass: string, type: "On" | "ForceOff" | "GracefulRestart" | "GracefulShutdown"): Promise<number> {
  const payload = JSON.stringify({ ResetType: type });
  const options: https.RequestOptions = {
    method: "POST",
    host,
    port: 443,
    path: "/redfish/v1/Systems/System.Embedded.1/Actions/ComputerSystem.Reset",
    rejectUnauthorized: false,
    auth: `${user}:${pass}`,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload)
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res: IncomingMessage) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.statusCode);
        } else {
          reject(new Error(`iDRAC reset failed: HTTP ${res.statusCode} - ${data}`));
        }
      });
    });
    
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

export async function redfishPowerStatus(host: string, user: string, pass: string): Promise<string> {
  const options: https.RequestOptions = {
    method: "GET",
    host,
    port: 443,
    path: "/redfish/v1/Systems/System.Embedded.1",
    rejectUnauthorized: false,
    auth: `${user}:${pass}`,
    headers: {
      "Accept": "application/json"
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res: IncomingMessage) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.PowerState || "Unknown");
        } catch (error) {
          reject(new Error(`Failed to parse iDRAC response: ${error.message}`));
        }
      });
    });
    
    req.on("error", reject);
    req.end();
  });
}

export async function redfishSystemInfo(host: string, user: string, pass: string): Promise<any> {
  const options: https.RequestOptions = {
    method: "GET",
    host,
    port: 443,
    path: "/redfish/v1/Systems/System.Embedded.1",
    rejectUnauthorized: false,
    auth: `${user}:${pass}`,
    headers: {
      "Accept": "application/json"
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res: IncomingMessage) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({
            model: parsed.Model,
            manufacturer: parsed.Manufacturer,
            serialNumber: parsed.SerialNumber,
            biosVersion: parsed.BiosVersion,
            powerState: parsed.PowerState,
            health: parsed.Status?.Health,
            memoryGiB: parsed.MemorySummary?.TotalSystemMemoryGiB,
            processorCount: parsed.ProcessorSummary?.Count
          });
        } catch (error) {
          reject(new Error(`Failed to parse system info: ${error.message}`));
        }
      });
    });
    
    req.on("error", reject);
    req.end();
  });
}