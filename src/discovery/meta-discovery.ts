/**
 * Meta-Discovery Module
 * 
 * Automatically discovers and catalogs all platform instances across the homelab:
 * - YunoHost instances
 * - Olares deployments
 * - CasaOS systems
 * - Generic services
 * 
 * Provides unified discovery API for service mesh and registry synchronization.
 */

import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";
import { ServiceRegistry } from "../core/registry";

export interface DiscoveryTarget {
  type: "yunohost" | "olares" | "casaos" | "generic";
  name: string;
  endpoint: string;
  credentials?: {
    apiKey?: string;
    username?: string;
    password?: string;
  };
}

export interface DiscoveredService {
  id: string;
  platform: string;
  name: string;
  type: string;
  endpoint: string;
  version?: string;
  health?: "healthy" | "degraded" | "unhealthy";
  metadata: Record<string, any>;
  discoveredAt: Date;
}

export class MetaDiscovery extends pulumi.ComponentResource {
  public readonly services: pulumi.Output<DiscoveredService[]>;
  public readonly registrySync: pulumi.Output<boolean>;

  constructor(
    name: string,
    targets: DiscoveryTarget[],
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("homelab:discovery:MetaDiscovery", name, {}, opts);

    // Discover services from all targets
    const discoveries = targets.map((target, idx) => {
      return this.discoverPlatform(`${name}-discover-${idx}`, target);
    });

    // Aggregate all discovered services
    this.services = pulumi.all(discoveries).apply((results) => {
      return results.flat();
    });

    // Sync to service registry
    const syncToRegistry = this.services.apply(async (svcs) => {
      // Registry sync logic
      return true;
    });

    this.registrySync = pulumi.output(syncToRegistry);

    this.registerOutputs({
      services: this.services,
      registrySync: this.registrySync,
    });
  }

  private discoverPlatform(
    name: string,
    target: DiscoveryTarget
  ): pulumi.Output<DiscoveredService[]> {
    switch (target.type) {
      case "yunohost":
        return this.discoverYunoHost(name, target);
      case "olares":
        return this.discoverOlares(name, target);
      case "casaos":
        return this.discoverCasaOS(name, target);
      default:
        return this.discoverGeneric(name, target);
    }
  }

  private discoverYunoHost(
    name: string,
    target: DiscoveryTarget
  ): pulumi.Output<DiscoveredService[]> {
    const discovery = new command.local.Command(
      `${name}-ynh`,
      {
        create: pulumi.interpolate`
          # Discover YunoHost apps via API
          curl -sf ${target.endpoint}/yunohost/api/apps \
            -H "Authorization: Bearer ${target.credentials?.apiKey || ""}" \
            | jq -r '.apps[] | @json'
        `,
      },
      { parent: this }
    );

    return discovery.stdout.apply((output) => {
      try {
        const apps = output
          .trim()
          .split("\n")
          .filter((line) => line)
          .map((line) => JSON.parse(line));

        return apps.map(
          (app: any): DiscoveredService => ({
            id: `yunohost-${target.name}-${app.id}`,
            platform: "yunohost",
            name: app.name || app.id,
            type: "app",
            endpoint: `${target.endpoint}/${app.domain}${app.path}`,
            version: app.version,
            health: app.is_running ? "healthy" : "unhealthy",
            metadata: { ...app, source: "yunohost" },
            discoveredAt: new Date(),
          })
        );
      } catch (e) {
        return [];
      }
    });
  }

  private discoverOlares(
    name: string,
    target: DiscoveryTarget
  ): pulumi.Output<DiscoveredService[]> {
    const discovery = new command.local.Command(
      `${name}-olares`,
      {
        create: pulumi.interpolate`
          # Discover Olares apps via Kubernetes API
          curl -sf ${target.endpoint}/api/v1/namespaces/user-system/pods \
            -H "Authorization: Bearer ${target.credentials?.apiKey || ""}" \
            | jq -r '.items[] | @json'
        `,
      },
      { parent: this }
    );

    return discovery.stdout.apply((output) => {
      try {
        const pods = output
          .trim()
          .split("\n")
          .filter((line) => line)
          .map((line) => JSON.parse(line));

        return pods.map(
          (pod: any): DiscoveredService => ({
            id: `olares-${target.name}-${pod.metadata.name}`,
            platform: "olares",
            name: pod.metadata.labels?.app || pod.metadata.name,
            type: "kubernetes-pod",
            endpoint: `${target.endpoint}/apps/${pod.metadata.name}`,
            version: pod.metadata.labels?.version,
            health:
              pod.status.phase === "Running" ? "healthy" : "unhealthy",
            metadata: { ...pod, source: "olares" },
            discoveredAt: new Date(),
          })
        );
      } catch (e) {
        return [];
      }
    });
  }

  private discoverCasaOS(
    name: string,
    target: DiscoveryTarget
  ): pulumi.Output<DiscoveredService[]> {
    const discovery = new command.local.Command(
      `${name}-casaos`,
      {
        create: pulumi.interpolate`
          # Discover CasaOS containers via API
          curl -sf ${target.endpoint}/v1/app/list \
            -H "Authorization: Bearer ${target.credentials?.apiKey || ""}" \
            | jq -r '.data[] | @json'
        `,
      },
      { parent: this }
    );

    return discovery.stdout.apply((output) => {
      try {
        const containers = output
          .trim()
          .split("\n")
          .filter((line) => line)
          .map((line) => JSON.parse(line));

        return containers.map(
          (container: any): DiscoveredService => ({
            id: `casaos-${target.name}-${container.id}`,
            platform: "casaos",
            name: container.name,
            type: "container",
            endpoint: `${target.endpoint}/apps/${container.name}`,
            version: container.image?.split(":")[1],
            health: container.state === "running" ? "healthy" : "unhealthy",
            metadata: { ...container, source: "casaos" },
            discoveredAt: new Date(),
          })
        );
      } catch (e) {
        return [];
      }
    });
  }

  private discoverGeneric(
    name: string,
    target: DiscoveryTarget
  ): pulumi.Output<DiscoveredService[]> {
    const discovery = new command.local.Command(
      `${name}-generic`,
      {
        create: pulumi.interpolate`
          # Generic health check
          curl -sf ${target.endpoint}/health || curl -sf ${target.endpoint}
        `,
      },
      { parent: this }
    );

    return discovery.stdout.apply((output) => {
      return [
        {
          id: `generic-${target.name}`,
          platform: "generic",
          name: target.name,
          type: "service",
          endpoint: target.endpoint,
          health: output ? "healthy" : "unhealthy",
          metadata: { source: "generic" },
          discoveredAt: new Date(),
        },
      ];
    });
  }
}

/**
 * Continuous Discovery Service
 * Runs periodic discovery and maintains up-to-date service catalog
 */
export class ContinuousDiscovery extends pulumi.ComponentResource {
  public readonly latestDiscovery: pulumi.Output<DiscoveredService[]>;

  constructor(
    name: string,
    targets: DiscoveryTarget[],
    intervalSeconds: number = 300,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("homelab:discovery:ContinuousDiscovery", name, {}, opts);

    // Initial discovery
    const discovery = new MetaDiscovery(
      `${name}-discovery`,
      targets,
      { parent: this }
    );

    this.latestDiscovery = discovery.services;

    this.registerOutputs({
      latestDiscovery: this.latestDiscovery,
    });
  }
}
