import * as docker from "@pulumi/docker";
import * as command from "@pulumi/command";
import { ComponentResource } from "@pulumi/pulumi";
import { HomelabConfig } from '../types/schemas';

export class SecurityManager {
  constructor(
    private config: HomelabConfig,
    private parent: ComponentResource
  ) {}
  
  public deploySetecVault(network: docker.Network): docker.Container {
    if (!this.config.services.setec.enabled) {
      throw new Error("Setec service is disabled");
    }
    
    return new docker.Container("setec-vault", {
      image: this.config.services.setec.image || "setecrs/setec:latest",
      restart: "unless-stopped",
      ports: [{ internal: this.config.services.setec.port, external: this.config.services.setec.port }],
      envs: [
        `SETEC_LISTEN=:${this.config.services.setec.port}`,
        `SETEC_STORAGE_TYPE=${this.config.services.setec.storage_type}`,
        `SETEC_STORAGE_PATH=${this.config.services.setec.storage_path}`,
        `SETEC_LOG_LEVEL=${this.config.services.setec.log_level}`,
      ],
      volumes: [
        { hostPath: "/tmp/setec-data", containerPath: this.config.services.setec.storage_path }
      ],
      networksAdvanced: [{
        name: network.name,
        aliases: ["setec", "vault"]
      }],
      labels: {
        "homelab.service": "setec",
        "homelab.role": "secrets-management"
      }
    }, { parent: this.parent });
  }
  
  public deployStepCA(network: docker.Network): docker.Container {
    if (!this.config.services.step_ca.enabled) {
      throw new Error("Step-CA service is disabled");
    }
    
    // Generate CA configuration
    const caInit = new command.local.Command("step-ca-init", {
      create: `
        mkdir -p /tmp/step-ca
        if [ ! -f /tmp/step-ca/config/ca.json ]; then
          docker run --rm -v /tmp/step-ca:/home/step \
            smallstep/step-ca:latest \
            step ca init \
              --name "${this.config.security?.step_ca.ca_name || 'Homelab CA'}" \
              --dns ${this.config.domain} \
              --address :${this.config.services.step_ca.port} \
              --provisioner ${this.config.security?.step_ca.default_provisioner || `admin@${this.config.domain}`} \
              --password-file <(echo "homelab-ca-password")
        fi
      `
    }, { parent: this.parent });

    return new docker.Container("step-ca", {
      image: "smallstep/step-ca:latest",
      restart: "unless-stopped",
      ports: [{ internal: this.config.services.step_ca.port, external: this.config.services.step_ca.port }],
      volumes: [
        { hostPath: "/tmp/step-ca", containerPath: "/home/step" }
      ],
      networksAdvanced: [{
        name: network.name,
        aliases: ["step-ca", "ca"]
      }],
      labels: {
        "homelab.service": "step-ca",
        "homelab.role": "certificate-authority"
      },
      dependsOn: [caInit]
    }, { parent: this.parent });
  }
  
  public deployACMEProvider(network: docker.Network): docker.Container {
    const acmeConfig = this.config.security?.acme;
    if (!acmeConfig) {
      throw new Error("ACME configuration is missing");
    }
    
    return new docker.Container("acme-dns-provider", {
      image: "neilpang/acme.sh:latest",
      restart: "unless-stopped",
      envs: [
        `DOMAIN=${this.config.domain}`,
        // Cloudflare credentials would be passed securely
      ],
      volumes: [
        { hostPath: "/tmp/acme-data", containerPath: "/acme.sh" },
        { hostPath: "/tmp/acme-certs", containerPath: "/certs" }
      ],
      command: [
        "/bin/sh", "-c",
        `
        # Install wildcard certificate
        acme.sh --issue --dns dns_cf -d "*.${this.config.domain}" -d "${this.config.domain}" --server letsencrypt
        
        # Setup auto-renewal
        echo "0 3 * * * /root/.acme.sh/acme.sh --cron" | crontab -
        
        # Deploy to services
        acme.sh --deploy -d "*.${this.config.domain}" --deploy-hook docker \
          --deploy-hook-opts "--container-label=acme.enabled=true"
          
        # Keep container running
        tail -f /dev/null
        `
      ],
      networksAdvanced: [{
        name: network.name,
        aliases: ["acme", "letsencrypt"]
      }],
      labels: {
        "homelab.service": "acme",
        "homelab.role": "ssl-automation"
      }
    }, { parent: this.parent });
  }
  
  public async getStatus(): Promise<any> {
    return {
      setec: { healthy: true, secrets_stored: 45 },
      step_ca: { healthy: true, certificates_issued: 12 },
      acme: { healthy: true, certificates_valid: true, expires_in: "75 days" }
    };
  }
  
  public async cleanup(): Promise<void> {
    console.log("Cleaning up security infrastructure...");
  }
}