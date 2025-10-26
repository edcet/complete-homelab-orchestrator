import fs from "fs";
import path from "path";

export interface PrometheusTarget {
  targets: string[];
  labels?: Record<string, string>;
}

export interface PrometheusJob {
  job: string;
  targets: PrometheusTarget[];
}

export class PrometheusServiceDiscovery {
  private outputDir: string;
  
  constructor(outputDir: string = "/tmp/prometheus-sd") {
    this.outputDir = outputDir;
  }

  async writeTargets(jobs: PrometheusJob[]): Promise<void> {
    fs.mkdirSync(this.outputDir, { recursive: true });
    
    for (const job of jobs) {
      const filePath = path.join(this.outputDir, `${job.job}.json`);
      const content = JSON.stringify(job.targets, null, 2);
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`✅ Wrote Prometheus targets: ${job.job} (${job.targets.length} targets)`);
    }
  }

  async generateHomelabTargets(domain: string, subnet: string): Promise<PrometheusJob[]> {
    const baseIP = subnet.split('/')[0].replace(/\d+$/, '');
    
    return [
      {
        job: "homelab-infrastructure",
        targets: [
          {
            targets: [`${baseIP}24:9090`], // Prometheus
            labels: { service: "prometheus", role: "monitoring", platform: "docker" }
          },
          {
            targets: [`${baseIP}24:3001`], // Grafana
            labels: { service: "grafana", role: "monitoring", platform: "docker" }
          },
          {
            targets: [`${baseIP}24:3001`], // Pangolin
            labels: { service: "pangolin", role: "gateway", platform: "docker" }
          },
          {
            targets: [`${baseIP}24:${8080}`], // Setec
            labels: { service: "setec", role: "secrets", platform: "docker" }
          },
          {
            targets: [`${baseIP}24:9000`], // Step-CA
            labels: { service: "step-ca", role: "certificates", platform: "docker" }
          }
        ]
      },
      {
        job: "homelab-platforms",
        targets: [
          {
            targets: [`${baseIP}24:8080`], // Olares
            labels: { service: "olares", role: "platform", platform: "kubernetes" }
          },
          {
            targets: [`${baseIP}110:80`], // YunoHost
            labels: { service: "yunohost", role: "platform", platform: "lxc" }
          },
          {
            targets: [`${baseIP}24:8083`], // CasaOS
            labels: { service: "casaos", role: "platform", platform: "docker" }
          }
        ]
      },
      {
        job: "homelab-network",
        targets: [
          {
            targets: [`${baseIP}24:3000`], // AdGuard
            labels: { service: "adguard", role: "dns", platform: "docker" }
          },
          {
            targets: [`${baseIP}24:8000`], // DDNS Updater
            labels: { service: "ddns", role: "dns", platform: "docker" }
          }
        ]
      },
      {
        job: "homelab-hardware",
        targets: [
          {
            targets: [`${baseIP}24:8006`], // Proxmox R240
            labels: { service: "proxmox", role: "hypervisor", hardware: "r240" }
          },
          {
            targets: [`${baseIP}25:8006`], // Proxmox R7910
            labels: { service: "proxmox", role: "hypervisor", hardware: "r7910" }
          },
          {
            targets: [`${baseIP}124:443`], // iDRAC R240
            labels: { service: "idrac", role: "bmc", hardware: "r240" }
          },
          {
            targets: [`${baseIP}125:443`], // iDRAC R7910
            labels: { service: "idrac", role: "bmc", hardware: "r7910" }
          }
        ]
      }
    ];
  }

  async syncFromDockerContainers(): Promise<PrometheusJob[]> {
    // Integration with Docker API to discover containers with metrics endpoints
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    
    try {
      const { stdout } = await execAsync('docker ps --format "{{.Names}}\t{{.Ports}}"');
      const containers = stdout.trim().split('\n').map(line => {
        const [name, ports] = line.split('\t');
        return { name, ports };
      });
      
      const targets: PrometheusTarget[] = [];
      
      for (const container of containers) {
        // Look for metrics ports (common: 9090, 9091, 2112, 8080/metrics)
        const metricsPortMatch = container.ports.match(/(\d+):([0-9]+)/);
        if (metricsPortMatch) {
          const [, externalPort] = metricsPortMatch;
          targets.push({
            targets: [`localhost:${externalPort}`],
            labels: {
              service: container.name,
              platform: "docker",
              job: "docker-containers"
            }
          });
        }
      }
      
      return [{
        job: "docker-discovered",
        targets
      }];
    } catch (error) {
      console.warn(`⚠️ Docker container discovery failed: ${error.message}`);
      return [];
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      return fs.existsSync(this.outputDir);
    } catch {
      return false;
    }
  }
}