/**
 * Service Registry
 * 
 * Central registry for all discovered services across the homelab.
 * Provides unified catalog and lookup APIs for cross-platform service management.
 */

import * as pulumi from "@pulumi/pulumi";
import type { DiscoveredService } from "../discovery/meta-discovery";

export interface RegistryEntry extends DiscoveredService {
  registeredAt: Date;
  lastSeen: Date;
  tags: string[];
  annotations: Record<string, string>;
}

export class ServiceRegistry extends pulumi.ComponentResource {
  public readonly entries: pulumi.Output<RegistryEntry[]>;
  public readonly healthyCount: pulumi.Output<number>;
  public readonly byPlatform: pulumi.Output<Record<string, RegistryEntry[]>>;

  constructor(
    name: string,
    services: pulumi.Input<DiscoveredService[]>,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("homelab:core:ServiceRegistry", name, {}, opts);

    // Transform discovered services to registry entries
    this.entries = pulumi.output(services).apply((svcs) =>
      svcs.map(
        (svc): RegistryEntry => ({
          ...svc,
          registeredAt: new Date(),
          lastSeen: new Date(),
          tags: this.generateTags(svc),
          annotations: this.generateAnnotations(svc),
        })
      )
    );

    // Calculate healthy service count
    this.healthyCount = this.entries.apply(
      (entries) => entries.filter((e) => e.health === "healthy").length
    );

    // Group services by platform
    this.byPlatform = this.entries.apply((entries) => {
      const grouped: Record<string, RegistryEntry[]> = {};
      for (const entry of entries) {
        if (!grouped[entry.platform]) {
          grouped[entry.platform] = [];
        }
        grouped[entry.platform].push(entry);
      }
      return grouped;
    });

    this.registerOutputs({
      entries: this.entries,
      healthyCount: this.healthyCount,
      byPlatform: this.byPlatform,
    });
  }

  private generateTags(svc: DiscoveredService): string[] {
    const tags = [svc.platform, svc.type];
    if (svc.health) {
      tags.push(svc.health);
    }
    return tags;
  }

  private generateAnnotations(svc: DiscoveredService): Record<string, string> {
    return {
      "homelab.io/platform": svc.platform,
      "homelab.io/discovered-at": svc.discoveredAt.toISOString(),
      "homelab.io/service-id": svc.id,
    };
  }

  // Query methods
  public query(
    filter: Partial<DiscoveredService>
  ): pulumi.Output<RegistryEntry[]> {
    return this.entries.apply((entries) =>
      entries.filter((entry) => {
        for (const [key, value] of Object.entries(filter)) {
          if (entry[key as keyof RegistryEntry] !== value) {
            return false;
          }
        }
        return true;
      })
    );
  }

  public findByName(name: string): pulumi.Output<RegistryEntry | undefined> {
    return this.entries.apply((entries) =>
      entries.find((e) => e.name === name)
    );
  }

  public findByPlatform(platform: string): pulumi.Output<RegistryEntry[]> {
    return this.entries.apply((entries) =>
      entries.filter((e) => e.platform === platform)
    );
  }
}

/**
 * Platform Synchronization
 * 
 * Synchronizes service metadata across platforms for unified management.
 */
export class PlatformSync extends pulumi.ComponentResource {
  public readonly syncComplete: pulumi.Output<boolean>;

  constructor(
    name: string,
    registry: ServiceRegistry,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("homelab:core:PlatformSync", name, {}, opts);

    // Sync logic: Export registry to all platforms
    this.syncComplete = registry.entries.apply(async (entries) => {
      // Platform-specific sync implementations would go here
      // This is a placeholder for actual sync logic
      return true;
    });

    this.registerOutputs({
      syncComplete: this.syncComplete,
    });
  }
}
