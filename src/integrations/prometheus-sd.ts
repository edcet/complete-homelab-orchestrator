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
    this.ensureOutputDir();
  }

  private ensureOutputDir(): void {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  async writeTargets(jobs: PrometheusJob[]): Promise<void> {
    this.ensureOutputDir();
    
    for (const job of jobs) {
      const filePath = path.join(this.outputDir, `${job.job}.json`);
      const content = JSON.stringify(job.targets, null, 2);
      
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`✅ Wrote Prometheus SD file: ${job.job} (${job.targets.length} targets)`);
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
            labels: { 
              service: "prometheus", 
              role: "monitoring", 
              platform: "docker",
              instance: "primary"
            }
          },
          {
            targets: [`${baseIP}24:3000`], // Grafana
            labels: { 
              service: "grafana", 
              role: "monitoring", 
              platform: "docker",
              instance: "primary"
            }
          },
          {
            targets: [`${baseIP}24:3001`], // Pangolin
            labels: { 
              service: "pangolin", 
              role: "gateway", 
              platform: "docker",
              component: "ingress"
            }
          },
          {
            targets: [`${baseIP}24:8080`], // Setec
            labels: { 
              service: "setec", 
              role: "secrets", 
              platform: "docker",
              component: "vault"
            }
          },
          {
            targets: [`${baseIP}24:9000`], // Step-CA
            labels: { 
              service: "step-ca", 
              role: "certificates", 
              platform: "docker",
              component: "pki"
            }
          }
        ]
      },
      {
        job: "homelab-dns",
        targets: [
          {
            targets: [`adguard-exporter:9617`], // AdGuard Exporter
            labels: { 
              service: "adguard", 
              role: "dns-filter", 
              platform: "docker",
              component: "dns"
            }
          },
          {
            targets: [`${baseIP}24:3000`], // AdGuard Web UI (for uptime)
            labels: { 
              service: "adguard-web", 
              role: "dns-admin", 
              platform: "docker",
              component: "web-ui"
            }
          }
        ]
      },
      {
        job: "homelab-platforms",
        targets: [
          {
            targets: [`${baseIP}110:9100`], // Node exporter on YunoHost LXC
            labels: { 
              service: "yunohost", 
              role: "platform", 
              platform: "lxc",
              node: "yunohost-lxc"
            }
          },
          {
            targets: [`${baseIP}201:6443`], // Kubernetes metrics on Olares
            labels: { 
              service: "olares", 
              role: "platform", 
              platform: "kubernetes",
              node: "olares-k3s"
            }
          }
        ]
      },
      {
        job: "homelab-hardware",
        targets: [
          {
            targets: [`${baseIP}24:8006`], // Proxmox metrics (via pve-exporter)
            labels: { 
              service: "proxmox", 
              role: "hypervisor", 
              hardware: "r240",
              node: "pve"
            }
          },
          {
            targets: [`${baseIP}25:8006`], // Proxmox R7910 (if configured)
            labels: { 
              service: "proxmox", 
              role: "hypervisor", 
              hardware: "r7910",
              node: "pve2"
            }
          }
        ]
      }
    ];
  }

  async syncFromDockerContainers(): Promise<PrometheusJob[]> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    
    try {
      const { stdout } = await execAsync(
        'docker ps --format "{{.Names}}\t{{.Ports}}\t{{.Labels}}"'
      );
      
      const containers = stdout.trim().split('\n')
        .filter(line => line.trim())
        .map(line => {
          const [name, ports, labels] = line.split('\t');
          return { name, ports: ports || '', labels: labels || '' };
        });
      
      const targets: PrometheusTarget[] = [];
      
      for (const container of containers) {
        // Look for prometheus scrape labels
        if (container.labels.includes('prometheus.scrape=true')) {
          const portMatch = container.labels.match(/prometheus\.port=([0-9]+)/);
          const pathMatch = container.labels.match(/prometheus\.path=([^,]+)/);
          
          if (portMatch) {
            const port = portMatch[1];
            const path = pathMatch ? pathMatch[1] : '/metrics';
            
            targets.push({
              targets: [`${container.name}:${port}`],
              labels: {
                service: container.name,
                platform: "docker",
                job: "docker-discovered",
                metrics_path: path
              }
            });
          }
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

  async listTargetFiles(): Promise<string[]> {
    try {
      const files = fs.readdirSync(this.outputDir)
        .filter(file => file.endsWith('.json'))
        .map(file => path.join(this.outputDir, file));
      
      return files;
    } catch {
      return [];
    }
  }

  async getTargetCounts(): Promise<Record<string, number>> {
    const files = await this.listTargetFiles();
    const counts: Record<string, number> = {};
    
    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        const targets = JSON.parse(content);
        const jobName = path.basename(file, '.json');
        counts[jobName] = Array.isArray(targets) ? targets.length : 0;
      } catch (error) {
        console.warn(`⚠️ Failed to read target file ${file}: ${error.message}`);
        counts[path.basename(file, '.json')] = 0;
      }
    }
    
    return counts;
  }

  async healthCheck(): Promise<boolean> {
    return fs.existsSync(this.outputDir) && fs.lstatSync(this.outputDir).isDirectory();
  }
}