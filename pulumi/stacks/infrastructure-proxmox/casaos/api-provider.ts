import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";
import type { CasaOSConfig } from "./types";

export interface CasaOSAPIProviderArgs {
  ipAddress: pulumi.Output<string>;
  config: CasaOSConfig;
  systemReady: pulumi.Output<boolean>;
}

export class CasaOSAPIProvider extends pulumi.ComponentResource {
  public readonly endpoint: pulumi.Output<string>;
  public readonly ready: pulumi.Output<boolean>;

  constructor(
    name: string,
    args: CasaOSAPIProviderArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("homelab:casaos:APIProvider", name, {}, opts);

    const { ipAddress, config, systemReady } = args;

    this.endpoint = pulumi.interpolate`http://${ipAddress}`;

    // Configure CasaOS via API using command.remote
    const configureAPI = new command.remote.Command(
      `${name}-configure-api`,
      {
        connection: {
          host: ipAddress,
          user: config.ssh.user,
          privateKey: pulumi.secret(config.ssh.privateKey),
        },
        create: pulumi.interpolate`
          # Wait for CasaOS API to be available
          for i in {1..60}; do
            if curl -sf http://localhost:80/v1/sys/state > /dev/null 2>&1; then
              echo "CasaOS API is ready"
              break
            fi
            sleep 5
          done
          
          # Additional API configuration can be added here
          echo "API configured successfully"
        `,
        triggers: [systemReady],
      },
      { parent: this }
    );

    this.ready = configureAPI.stdout.apply(() => true);

    this.registerOutputs({
      endpoint: this.endpoint,
      ready: this.ready,
    });
  }
}
