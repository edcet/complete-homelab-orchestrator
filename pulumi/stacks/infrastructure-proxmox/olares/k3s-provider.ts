import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { dynamic } from "@pulumi/pulumi";

interface Args { vm: pulumi.Input<any>; }

class K3sProvider implements dynamic.ResourceProvider {
  async create(inputs: any) {
    // MCP-native: assume hypervisor-tools expose guest IP via provider data source; no SSH/shell
    // Expect inputs.vm has ipAddress output from Proxmox agent; rely on metadata only
    const kubeconfig = JSON.stringify({ apiVersion: "v1", clusters: [], contexts: [], users: [] });
    return { id: `k3s-${Date.now()}`, outs: { kubeconfig } };
  }
  async diff(id: string, olds: any, news: any) { return { changes: false }; }
}

export function createK3s(name: string, args: Args, opts?: pulumi.CustomResourceOptions) {
  const resource = new dynamic.Resource(new K3sProvider(), name, {}, opts);
  const provider = new k8s.Provider(`${name}-k8s`, {
    kubeconfig: resource.getOutput("kubeconfig") as pulumi.Input<string>,
  }, opts);
  return { resource, provider };
}
