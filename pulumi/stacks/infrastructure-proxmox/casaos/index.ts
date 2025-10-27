import * as pulumi from "@pulumi/pulumi";
import * as proxmox from "@muhlba91/pulumi-proxmoxve";
import { CasaOSProxmoxProvider } from "./proxmox-provider";
import { CasaOSInitProvider } from "./init-provider";
import { CasaOSAPIProvider } from "./api-provider";
import { CasaOSAppProvider } from "./app-provider";
import type { CasaOSConfig } from "./types";

export interface CasaOSStackArgs {
  config: CasaOSConfig;
  proxmoxProvider: proxmox.Provider;
}

export class CasaOSStack extends pulumi.ComponentResource {
  public readonly vm: proxmox.vm.VirtualMachine;
  public readonly ipAddress: pulumi.Output<string>;
  public readonly apiEndpoint: pulumi.Output<string>;
  public readonly apps: pulumi.Output<any[]>;

  constructor(name: string, args: CasaOSStackArgs, opts?: pulumi.ComponentResourceOptions) {
    super("homelab:casaos:Stack", name, {}, opts);

    // Step 1: Create Proxmox VM with CasaOS
    const proxmoxProvider = new CasaOSProxmoxProvider(
      `${name}-proxmox`,
      {
        config: args.config,
        proxmoxProvider: args.proxmoxProvider,
      },
      { parent: this }
    );

    this.vm = proxmoxProvider.vm;
    this.ipAddress = proxmoxProvider.ipAddress;

    // Step 2: Initialize CasaOS system (pure Pulumi/SSH)
    const initProvider = new CasaOSInitProvider(
      `${name}-init`,
      {
        vm: this.vm,
        ipAddress: this.ipAddress,
        config: args.config,
      },
      { parent: this, dependsOn: [proxmoxProvider] }
    );

    // Step 3: Configure CasaOS via API
    const apiProvider = new CasaOSAPIProvider(
      `${name}-api`,
      {
        ipAddress: this.ipAddress,
        config: args.config,
        systemReady: initProvider.systemReady,
      },
      { parent: this, dependsOn: [initProvider] }
    );

    this.apiEndpoint = apiProvider.endpoint;

    // Step 4: Deploy applications via API
    const appProvider = new CasaOSAppProvider(
      `${name}-apps`,
      {
        apiEndpoint: this.apiEndpoint,
        config: args.config,
        apiReady: apiProvider.ready,
      },
      { parent: this, dependsOn: [apiProvider] }
    );

    this.apps = appProvider.deployedApps;

    this.registerOutputs({
      vm: this.vm,
      ipAddress: this.ipAddress,
      apiEndpoint: this.apiEndpoint,
      apps: this.apps,
    });
  }
}
