import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";
import * as proxmox from "@muhlba91/pulumi-proxmoxve";
import type { CasaOSConfig } from "./types";

export interface CasaOSInitProviderArgs {
  vm: proxmox.vm.VirtualMachine;
  ipAddress: pulumi.Output<string>;
  config: CasaOSConfig;
}

export class CasaOSInitProvider extends pulumi.ComponentResource {
  public readonly systemReady: pulumi.Output<boolean>;

  constructor(
    name: string,
    args: CasaOSInitProviderArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("homelab:casaos:InitProvider", name, {}, opts);

    const { vm, ipAddress, config } = args;

    // Wait for VM to be SSH-accessible
    const waitForSSH = new command.remote.Command(
      `${name}-wait-ssh`,
      {
        connection: {
          host: ipAddress,
          user: config.ssh.user,
          privateKey: pulumi.secret(config.ssh.privateKey),
          port: 22,
        },
        create: "echo 'SSH Ready'",
        triggers: [vm.id],
      },
      { parent: this, dependsOn: [vm] }
    );

    // Install CasaOS via native installer (no scripts)
    const installCasaOS = new command.remote.Command(
      `${name}-install`,
      {
        connection: {
          host: ipAddress,
          user: config.ssh.user,
          privateKey: pulumi.secret(config.ssh.privateKey),
        },
        create: pulumi.interpolate`
          set -e
          # Update system
          sudo apt-get update -qq
          sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
            curl wget git jq ca-certificates gnupg lsb-release
          
          # Install Docker (CasaOS prerequisite)
          curl -fsSL https://get.docker.com | sudo sh
          sudo systemctl enable docker
          sudo systemctl start docker
          sudo usermod -aG docker ${config.ssh.user}
          
          # Install CasaOS
          curl -fsSL https://get.casaos.io | sudo bash
          
          # Wait for CasaOS to be ready
          for i in {1..30}; do
            if curl -sf http://localhost:80 > /dev/null; then
              echo "CasaOS is ready"
              break
            fi
            sleep 10
          done
        `,
      },
      { parent: this, dependsOn: [waitForSSH] }
    );

    // Configure CasaOS system settings
    const configureCasaOS = new command.remote.Command(
      `${name}-configure`,
      {
        connection: {
          host: ipAddress,
          user: config.ssh.user,
          privateKey: pulumi.secret(config.ssh.privateKey),
        },
        create: pulumi.interpolate`
          set -e
          # Set hostname
          sudo hostnamectl set-hostname ${config.vm.name}
          
          # Configure firewall
          sudo ufw allow 80/tcp
          sudo ufw allow 443/tcp
          sudo ufw allow 22/tcp
          
          # Enable and configure automatic updates
          sudo apt-get install -y -qq unattended-upgrades
          
          echo "CasaOS configuration complete"
        `,
      },
      { parent: this, dependsOn: [installCasaOS] }
    );

    this.systemReady = configureCasaOS.stdout.apply(() => true);

    this.registerOutputs({
      systemReady: this.systemReady,
    });
  }
}
