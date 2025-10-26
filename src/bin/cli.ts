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

program
  .command("interactive")
  .description("Interactive setup wizard")
  .action(async () => {
    const { runInteractiveWizard } = await import("../wizard/interactive");
    await runInteractiveWizard();
  });

program.parse();