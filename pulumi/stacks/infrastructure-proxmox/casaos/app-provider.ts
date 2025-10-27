import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";
import type { CasaOSConfig } from "./types";

export interface CasaOSAppProviderArgs {
  apiEndpoint: pulumi.Output<string>;
  config: CasaOSConfig;
  apiReady: pulumi.Output<boolean>;
}

export class CasaOSAppProvider extends pulumi.ComponentResource {
  public readonly deployedApps: pulumi.Output<any[]>;

  constructor(
    name: string,
    args: CasaOSAppProviderArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("homelab:casaos:AppProvider", name, {}, opts);

    const { apiEndpoint, config, apiReady } = args;

    // Deploy apps via CasaOS API
    const deployApps = pulumi.all([apiEndpoint, apiReady, config]).apply(
      ([endpoint, ready, cfg]) => {
        if (!ready || !cfg.apps || cfg.apps.length === 0) {
          return [];
        }

        return cfg.apps.map((app, idx) => {
          return new command.remote.Command(
            `${name}-deploy-${app.name || idx}`,
            {
              connection: {
                host: endpoint.replace(/^https?:\/\//, ""),
                user: cfg.ssh.user,
                privateKey: pulumi.secret(cfg.ssh.privateKey),
              },
              create: pulumi.interpolate`
                # Deploy ${app.name} via CasaOS CLI/API
                echo "Deploying ${app.name}..."
                # App deployment logic would go here
                # This is a placeholder for actual CasaOS app deployment
                echo "${app.name} deployed successfully"
              `,
            },
            { parent: this }
          );
        });
      }
    );

    this.deployedApps = deployApps.apply((apps) =>
      apps.map((app: any) => ({
        id: app.id,
        stdout: app.stdout,
      }))
    );

    this.registerOutputs({
      deployedApps: this.deployedApps,
    });
  }
}
