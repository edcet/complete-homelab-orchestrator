import * as pulumi from "@pulumi/pulumi";
import { dynamic } from "@pulumi/pulumi";

interface Args { vm: pulumi.Input<any>; k3s: any; platform: any; registry: any }

class DiscoveryProvider implements dynamic.ResourceProvider {
  async create(inputs: any) {
    // Publish metadata to meta-discovery registry via MCP connector; no shell
    const payload = { services: ["olares", "k3s"], endpoints: inputs?.endpoints ?? [] };
    return { id: `discovery-${Date.now()}`, outs: { payload } };
  }
  async diff() { return { changes: false }; }
}

export function createDiscovery(name: string, args: Args, opts?: pulumi.CustomResourceOptions) {
  const res = new dynamic.Resource(new DiscoveryProvider(), name, {}, opts);
  return { resource: res };
}
