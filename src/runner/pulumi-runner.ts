import * as pulumi from "@pulumi/pulumi";
import * as automation from "@pulumi/pulumi/x/automation";
import { HomelabConfig } from "../types/schemas";
import { CompleteHomelabOrchestrator } from "../core/orchestrator";

export interface PulumiOptions {
  preview?: boolean;
  stack?: string;
  destroy?: boolean;
}

export async function runPulumi(config: HomelabConfig, opts: PulumiOptions = {}) {
  const stackName = opts.stack || "dev";
  const projectName = "complete-homelab-orchestrator";

  // Set passphrase if not provided
  process.env.PULUMI_CONFIG_PASSPHRASE = process.env.PULUMI_CONFIG_PASSPHRASE || "homelab-dev";

  const program = pulumi.runtime.createMockResourceMonitor({
    call: async (args) => ({ return: {} }),
    invoke: async (args) => ({ return: {} }),
    readResource: async (args) => ({ urn: args.urn, id: args.id, state: {} }),
    registerResource: async (args) => ({ urn: args.urn, id: args.id, object: args.object }),
    registerResourceOutputs: async () => ({})
  });

  const pulumiProgram = async () => {
    console.log(`🚀 Creating homelab orchestrator for domain: ${config.domain}`);
    const orchestrator = new CompleteHomelabOrchestrator("homelab", config);
    
    // Export key outputs
    return {
      pangolinEndpoint: orchestrator.pangolinGateway?.name || "not-deployed",
      tailscaleStatus: "configured",
      mcpEndpoint: config.networks.mcp_endpoint,
      domain: config.domain
    };
  };

  try {
    const { LocalWorkspace } = automation;
    
    // Create workspace with inline program
    const ws = await LocalWorkspace.create({
      projectSettings: {
        name: projectName,
        runtime: "nodejs",
        description: "Complete Homelab Orchestrator"
      },
      program: pulumiProgram
    });

    // Create or select stack
    const stack = await automation.LocalWorkspace.createOrSelectStack({
      stackName,
      projectName,
      program: pulumiProgram,
      workspace: ws
    });

    console.log(`📋 Using Pulumi stack: ${stackName}`);

    // Set configuration
    await stack.setConfig("homelab:domain", { value: config.domain });
    await stack.setConfig("homelab:zone_id", { value: config.zone_id, secret: true });
    await stack.setConfig("homelab:tailscale_key", { value: config.tailscale_auth_key, secret: true });

    if (opts.destroy) {
      console.log("🔥 Destroying stack...");
      const result = await stack.destroy({ onOutput: console.log });
      console.log(`✅ Destroy completed. Resources destroyed: ${result.summary.resourceChanges?.destroy || 0}`);
      return result;
    }

    if (opts.preview) {
      console.log("👁️ Previewing changes...");
      const result = await stack.preview({ onOutput: console.log });
      console.log(`📊 Preview completed. Changes: +${result.changeSummary.create || 0} ~${result.changeSummary.update || 0} -${result.changeSummary.delete || 0}`);
      return result;
    } else {
      console.log("🔄 Applying changes...");
      const result = await stack.up({ onOutput: console.log });
      console.log(`✅ Deployment completed. Resources created: ${result.summary.resourceChanges?.create || 0}`);
      
      // Display key outputs
      if (result.outputs) {
        console.log("\n📋 Stack Outputs:");
        Object.entries(result.outputs).forEach(([key, value]) => {
          console.log(`   ${key}: ${value}`);
        });
      }
      
      return result;
    }
  } catch (error) {
    console.error(`❌ Pulumi execution failed: ${error.message}`);
    throw error;
  }
}