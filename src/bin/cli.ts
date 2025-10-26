#!/usr/bin/env node
import { Command } from "commander";
import path from "path";
import fs from "fs";
import YAML from "yaml";
import { HomelabConfigSchema, validateConfigSafe } from "../types/schemas";
import { runPulumi } from "../runner/pulumi-runner";

const program = new Command();

function readConfig(configPath?: string) {
  const p = configPath || process.env.HOMELAB_CONFIG || path.resolve(process.cwd(), "examples/advanced/homelab.yaml");
  if (!fs.existsSync(p)) {
    throw new Error(`Config file not found: ${p}`);
  }
  const raw = fs.readFileSync(p, "utf8");
  const data = p.endsWith(".json") ? JSON.parse(raw) : YAML.parse(raw);
  const result = validateConfigSafe(data);
  if (!result.success) {
    console.error("❌ Config validation failed:");
    result.error.issues.forEach(i => console.error(`- ${i.path.join(".")}: ${i.message}`));
    process.exit(1);
  }
  return result.data;
}

program
  .name("homelab")
  .description("Complete Homelab Orchestrator CLI")
  .version("2.2.0");

program
  .command("config:init")
  .description("Create a starter config")
  .option("-o, --output <path>", "Output path", "./homelab.yaml")
  .action((opts) => {
    const out = path.resolve(opts.output);
    const sample = fs.readFileSync(path.resolve(__dirname, "../../examples/basic/homelab.yaml"), "utf8");
    fs.writeFileSync(out, sample, "utf8");
    console.log(`✅ Wrote starter config to ${out}`);
  });

program
  .command("validate")
  .description("Validate configuration against schema")
  .option("-c, --config <path>", "Path to config file")
  .action((opts) => {
    const cfg = readConfig(opts.config);
    console.log("✅ Configuration is valid.");
    console.log(`📊 Domain: ${cfg.domain}`);
    console.log(`🌐 Network: ${cfg.networks.primary_subnet}`);
    console.log(`🔧 Services enabled: ${Object.entries(cfg.services).filter(([, s]) => s.enabled).map(([n]) => n).join(", ")}`);
  });

program
  .command("deploy")
  .description("Deploy homelab stack with Pulumi")
  .option("-c, --config <path>", "Path to config file")
  .option("--preview", "Preview only", false)
  .option("--stack <name>", "Pulumi stack name", "dev")
  .action(async (opts) => {
    const cfg = readConfig(opts.config);
    console.log(`🚀 Deploying homelab to stack: ${opts.stack}`);
    await runPulumi(cfg, { preview: !!opts.preview, stack: opts.stack });
  });

// Proxmox management commands
program
  .command("proxmox")
  .description("Proxmox VE management")
  .addCommand(
    new Command("status")
      .description("Show Proxmox infrastructure status")
      .option("-c, --config <path>", "Path to config file")
      .action(async (opts) => {
        const cfg = readConfig(opts.config);
        console.log("📊 Proxmox Infrastructure Status:");
        
        try {
          const { ProxmoxFactory } = await import("../providers/proxmox-factory");
          // This would connect to real Proxmox API
          const factory = new ProxmoxFactory(null as any, cfg);
          const containers = await factory.listContainers();
          
          console.log(`   Containers/VMs: ${containers.length}`);
          containers.forEach(vm => {
            console.log(`   - ${vm.name} (${vm.vmid}): ${vm.status}`);
          });
        } catch (error) {
          console.error(`❌ Failed to get Proxmox status: ${error.message}`);
        }
      })
  )
  .addCommand(
    new Command("provision")
      .description("Provision new container or VM")
      .option("-c, --config <path>", "Path to config file")
      .option("--type <type>", "Type: lxc or vm", "lxc")
      .option("--vmid <id>", "VM/Container ID", "300")
      .option("--name <name>", "Name", "test-container")
      .action(async (opts) => {
        const cfg = readConfig(opts.config);
        console.log(`🚀 Provisioning ${opts.type}: ${opts.name} (${opts.vmid})`);
        
        // This would trigger actual provisioning via Pulumi
        console.log("✅ Provision command queued (would execute via Pulumi)");
      })
  );

// AdGuard management commands
program
  .command("adguard")
  .description("AdGuard Home management")
  .addCommand(
    new Command("sync-clients")
      .description("Sync clients from Tailscale mesh")
      .option("-c, --config <path>", "Path to config file")
      .action(async (opts) => {
        const cfg = readConfig(opts.config);
        console.log("🔄 Syncing AdGuard clients from Tailscale...");
        
        const { AdGuardHomeClient } = await import("../integrations/adguard");
        const { TailscaleClient } = await import("../integrations/tailscale");
        const { AdGuardExporter } = await import("../exporters/adguard-exporter");
        const { PrometheusServiceDiscovery } = await import("../integrations/prometheus-sd");
        
        const adguard = new AdGuardHomeClient(`http://localhost:${cfg.services.adguard.web_port}`);
        const tailscale = new TailscaleClient(process.env.TAILSCALE_API_KEY!);
        const prometheus = new PrometheusServiceDiscovery();
        
        const exporter = new AdGuardExporter(cfg, adguard, tailscale, prometheus, null as any);
        await exporter.syncClientsFromTailscale();
        
        console.log("✅ Client sync complete");
      })
  )
  .addCommand(
    new Command("status")
      .description("Show AdGuard status and metrics")
      .option("-c, --config <path>", "Path to config file")
      .action(async (opts) => {
        const cfg = readConfig(opts.config);
        
        const { AdGuardHomeClient } = await import("../integrations/adguard");
        const adguard = new AdGuardHomeClient(`http://localhost:${cfg.services.adguard.web_port}`);
        
        try {
          const stats = await adguard.getStats();
          const clients = await adguard.getClients();
          
          console.log("📊 AdGuard Home Status:");
          console.log(`   DNS Queries: ${stats.num_dns_queries}`);
          console.log(`   Blocked: ${stats.num_blocked_filtering}`);
          console.log(`   Clients: ${clients.length}`);
          console.log(`   Tailscale Clients: ${clients.filter(c => c.tags?.includes('tailscale')).length}`);
        } catch (error) {
          console.error(`❌ Failed to get AdGuard status: ${error.message}`);
        }
      })
  );

// Tailscale management commands
program
  .command("tailscale")
  .description("Tailscale management commands")
  .addCommand(
    new Command("reconcile")
      .description("Run Tailscale state reconciliation")
      .option("-c, --config <path>", "Path to config file")
      .action(async (opts) => {
        const cfg = readConfig(opts.config);
        const { TailscaleClient } = await import("../integrations/tailscale");
        const { TailscaleReconciler } = await import("../integrations/tailscale-reconciler");
        
        const client = new TailscaleClient(process.env.TAILSCALE_API_KEY!);
        const reconciler = new TailscaleReconciler(client, cfg);
        
        console.log("🔄 Running Tailscale reconciliation...");
        await reconciler.reconcileState();
        console.log("✅ Reconciliation complete");
      })
  )
  .addCommand(
    new Command("status")
      .description("Show Tailscale mesh status")
      .option("-c, --config <path>", "Path to config file") 
      .action(async (opts) => {
        const cfg = readConfig(opts.config);
        const { TailscaleClient } = await import("../integrations/tailscale");
        
        const client = new TailscaleClient(process.env.TAILSCALE_API_KEY!);
        const devices = await client.getDevices();
        const routes = await client.getRoutes();
        
        console.log("📊 Tailscale Mesh Status:");
        console.log(`   Devices: ${devices.length}`);
        console.log(`   Routes: ${routes.length} (${routes.filter(r => r.approved).length} approved)`);
        console.log(`   Homelab devices: ${devices.filter(d => d.tags?.includes('tag:homelab')).length}`);
      })
  );

// Prometheus management  
program
  .command("prometheus")
  .description("Prometheus service discovery")
  .addCommand(
    new Command("generate-targets")
      .description("Generate Prometheus service discovery targets")
      .option("-c, --config <path>", "Path to config file")
      .option("-o, --output <path>", "Output directory", "/tmp/prometheus-sd")
      .action(async (opts) => {
        const cfg = readConfig(opts.config);
        const { PrometheusServiceDiscovery } = await import("../integrations/prometheus-sd");
        
        const prometheus = new PrometheusServiceDiscovery(opts.output);
        
        console.log("📊 Generating Prometheus targets...");
        
        // Generate homelab targets
        const homelabTargets = await prometheus.generateHomelabTargets(
          cfg.domain, 
          cfg.networks.primary_subnet
        );
        
        // Discover Docker containers
        const dockerTargets = await prometheus.syncFromDockerContainers();
        
        // Write all targets
        await prometheus.writeTargets([...homelabTargets, ...dockerTargets]);
        
        const counts = await prometheus.getTargetCounts();
        console.log("✅ Target generation complete:");
        Object.entries(counts).forEach(([job, count]) => {
          console.log(`   ${job}: ${count} targets`);
        });
      })
  );

program
  .command("status")
  .description("Show orchestrator status")
  .option("-c, --config <path>", "Path to config file")
  .option("--json", "Output JSON", false)
  .action(async (opts) => {
    try {
      const cfg = readConfig(opts.config);
      const { getOrchestrator } = await import("../index");
      const orch = await getOrchestrator(cfg);
      const status = await orch.getStatus();
      
      if (opts.json) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        console.log("📊 Homelab Status:");
        console.log(`   Orchestrator: ${status.orchestrator}`);
        console.log(`   Services: ${Object.keys(status.services || {}).length} active`);
        console.log(`   Network: ${status.network?.tailscale ? '✅' : '❌'} Tailscale`);
        console.log(`   MCP: ${status.mcp?.server_running ? '✅' : '❌'} Server`);
      }
    } catch (error) {
      console.error(`❌ Status check failed: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command("r240:bootstrap")
  .description("Bootstrap Dell R240 via iDRAC + Proxmox")
  .option("-c, --config <path>", "Path to config file")
  .action(async (opts) => {
    const cfg = readConfig(opts.config);
    console.log("🔥 Bootstrapping Dell R240...");
    const { bootstrapR240 } = await import("../providers/r240");
    await bootstrapR240(cfg);
    console.log("✅ R240 bootstrap sequence completed.");
  });

program
  .command("schema:emit")
  .description("Emit JSON Schema from Zod")
  .option("-o, --output <path>", "Output file", "./docs/config.schema.json")
  .action(async (opts) => {
    try {
      const { zodToJsonSchema } = await import("zod-to-json-schema");
      const schema = zodToJsonSchema(HomelabConfigSchema, "HomelabConfig");
      fs.mkdirSync(path.dirname(opts.output), { recursive: true });
      fs.writeFileSync(opts.output, JSON.stringify(schema, null, 2));
      console.log(`✅ Wrote JSON Schema to ${opts.output}`);
    } catch (error) {
      console.error(`❌ Schema emit failed: ${error.message}`);
      process.exit(1);
    }
  });

program.parse();