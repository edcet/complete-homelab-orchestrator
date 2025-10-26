#!/usr/bin/env ts-node
import fs from "fs";
import path from "path";
import YAML from "yaml";
import { HomelabConfigSchema, validateConfigSafe } from "../src/types/schemas";

const configPath = process.argv[2] || path.resolve(process.env.HOME || "~", ".config/homelab/homelab.yaml");

if (!fs.existsSync(configPath)) {
  console.error(`❌ Config not found: ${configPath}`);
  console.error(`\nCreate a config file with:\n  homelab config init`);
  process.exit(2);
}

const raw = fs.readFileSync(configPath, "utf8");
let data: any;

try {
  data = configPath.endsWith(".json") ? JSON.parse(raw) : YAML.parse(raw);
} catch (parseError) {
  console.error(`❌ Config parse error: ${parseError}`);
  process.exit(3);
}

const result = validateConfigSafe(data);

if (!result.success) {
  console.error("❌ Config validation failed:");
  console.error("\n🔍 Issues found:");
  
  result.error.issues.forEach((issue, index) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "root";
    console.error(`  ${index + 1}. ${path}: ${issue.message}`);
    
    if (issue.code === "invalid_type") {
      console.error(`     Expected: ${issue.expected}, Received: ${issue.received}`);
    }
  });
  
  console.error(`\n💡 Fix these ${result.error.issues.length} issues and try again.`);
  process.exit(1);
}

console.log("✅ Config validation passed!");
console.log(`📋 Domain: ${result.data.domain}`);
console.log(`🌐 Network: ${result.data.networks.primary_subnet}`);
console.log(`🔧 Services enabled: ${Object.entries(result.data.services)
  .filter(([, service]) => service.enabled)
  .map(([name]) => name)
  .join(", ")}`);

process.exit(0);