import { z } from "zod";

export const HardwareSchema = z.object({
  ip: z.string().ip({ version: "v4" }),
  idrac_ip: z.string().ip({ version: "v4" }),
  idrac_user: z.string().min(1),
  ssh_port: z.number().int().min(1).max(65535).default(22),
  proxmox_port: z.number().int().min(1).max(65535).optional(),
});

export const NetworksSchema = z.object({
  primary_subnet: z.string().regex(/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/),
  tailnet_domain: z.string().min(3).optional(),
  docker_network: z.string().min(1),
  wireguard_port: z.number().int().min(1).max(65535).default(51820),
  mcp_endpoint: z.number().int().min(1024).max(65535),
});

export const ServiceToggleSchema = z.object({
  enabled: z.boolean(),
  image: z.string().optional(),
  ports: z.array(z.number().int().min(1).max(65535)).optional(),
  environment: z.record(z.string()).optional(),
  volumes: z.array(z.object({
    host: z.string(),
    container: z.string()
  })).optional(),
  health_endpoint: z.string().optional(),
  config_path: z.string().optional(),
});

export const PangolinSchema = ServiceToggleSchema.extend({
  api_path: z.string().min(1).default("/api/v1"),
  wireguard_port: z.number().int().min(1).max(65535).default(51820),
});

export const NewtSchema = ServiceToggleSchema.extend({
  metrics_port: z.number().int().min(1).max(65535).default(2112),
  docker_discovery: z.boolean().default(true),
  health_file: z.string().default("/tmp/healthy"),
  log_level: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]).default("INFO"),
});

export const OlmSchema = ServiceToggleSchema.extend({
  interface: z.string().min(2).default("olm0"),
  holepunch: z.boolean().default(true),
  port: z.number().int().min(1).max(65535).optional(),
});

export const CloudflaredSchema = ServiceToggleSchema.extend({
  tunnel_name: z.string().min(2),
  config_path: z.string().default("/etc/cloudflared"),
});

export const SetecSchema = ServiceToggleSchema.extend({
  port: z.number().int().min(1).max(65535).default(8080),
  storage_type: z.enum(["badger", "postgres", "memory"]).default("badger"),
  storage_path: z.string().default("/data"),
  log_level: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export const StepCASchema = ServiceToggleSchema.extend({
  port: z.number().int().min(1).max(65535).default(9000),
  config_path: z.string().default("/home/step"),
});

export const AdGuardSchema = ServiceToggleSchema.extend({
  web_port: z.number().int().min(1).max(65535).default(3000),
  dns_port: z.number().int().min(1).max(65535).default(53),
});

export const DDNSUpdaterSchema = ServiceToggleSchema.extend({
  port: z.number().int().min(1).max(65535).default(8000),
  update_period: z.string().regex(/^\d+[smhd]$/).default("5m"),
  cooldown_period: z.string().regex(/^\d+[smhd]$/).default("5m"),
});

export const YunoHostSchema = ServiceToggleSchema.extend({
  deployment_type: z.literal("lxc"),
  container_id: z.number().int().positive(),
  memory: z.string().regex(/^\d+$/),
  cores: z.number().int().positive(),
  storage: z.string().optional(),
});

export const OlaresSchema = ServiceToggleSchema.extend({
  port: z.number().int().min(1).max(65535).default(8080),
  k8s_port: z.number().int().min(1).max(65535).default(6443),
  k8s_integration: z.boolean().default(true),
  storage_provider: z.enum(["zfs", "ext4", "btrfs"]).default("zfs"),
});

export const CasaOSSchema = ServiceToggleSchema.extend({
  port: z.number().int().min(1).max(65535).default(80),
});

export const HomepageSchema = ServiceToggleSchema.extend({
  port: z.number().int().min(1).max(65535).default(3000),
});

export const ServicesSchema = z.object({
  pangolin: PangolinSchema,
  newt: NewtSchema,
  olm: OlmSchema,
  cloudflared: CloudflaredSchema,
  setec: SetecSchema,
  step_ca: StepCASchema,
  adguard: AdGuardSchema,
  ddns_updater: DDNSUpdaterSchema,
  yunohost: YunoHostSchema,
  olares: OlaresSchema,
  casaos: CasaOSSchema,
  homepage: HomepageSchema,
}).strict();

export const IntegrationsSchema = z.object({
  pangolin_tailscale: z.object({
    webhook_endpoint: z.string().min(1),
    sync_routes: z.boolean().default(true),
    auto_discovery: z.boolean().default(true),
  }),
  cloudflare_setec: z.object({
    acme_hook: z.string().min(1),
    auto_ssl: z.boolean().default(true),
    wildcard_domains: z.boolean().default(true),
  }),
  service_discovery: z.object({
    scan_interval: z.string().regex(/^\d+[smhd]$/).default("60s"),
    platforms: z.array(z.enum(["docker", "kubernetes", "yunohost", "olares", "casaos"])).nonempty(),
    auto_register_dns: z.boolean().default(true),
    auto_configure_proxy: z.boolean().default(true),
  }),
}).strict().optional();

export const SecuritySchema = z.object({
  step_ca: z.object({
    ca_name: z.string().min(3),
    default_provisioner: z.string().email(),
    key_type: z.enum(["EC", "RSA"]).default("EC"),
    curve: z.string().default("P-256"),
  }),
  acme: z.object({
    email: z.string().email(),
    dns_provider: z.literal("cloudflare"),
    challenge_type: z.literal("dns-01"),
    cert_duration: z.string().regex(/^\d+h$/).default("2160h"),
  }),
  auth: z.object({
    enable_sso: z.boolean().default(false),
    oidc_provider: z.enum(["cloudflare", "auth0"]).optional(),
    session_timeout: z.string().regex(/^\d+h$/).default("24h"),
  }),
}).strict().optional();

export const MonitoringSchema = z.object({
  healthchecks: z.object({
    interval: z.string().regex(/^\d+[smhd]$/).default("30s"),
    timeout: z.string().regex(/^\d+[smhd]$/).default("10s"),
    retries: z.number().int().min(1).max(10).default(3),
  }),
  metrics: z.object({
    prometheus_port: z.number().int().min(1).max(65535).default(9090),
    grafana_port: z.number().int().min(1).max(65535).default(3001),
    enable_alerts: z.boolean().default(true),
  }),
  logging: z.object({
    level: z.enum(["debug", "info", "warn", "error"]).default("info"),
    format: z.enum(["json", "text"]).default("json"),
    retention: z.string().regex(/^\d+d$/).default("7d"),
  }),
}).strict().optional();

export const MetadataSchema = z.object({
  deployment_id: z.string().min(3),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  created: z.string().datetime(),
}).optional();

export const HomelabConfigSchema = z.object({
  metadata: MetadataSchema,
  domain: z.string().regex(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/),
  zone_id: z.string().length(32),
  tailscale_auth_key: z.string().startsWith("tskey-"),
  networks: NetworksSchema,
  hardware: z.object({
    r240: HardwareSchema,
    r7910: HardwareSchema,
  }),
  services: ServicesSchema,
  integrations: IntegrationsSchema,
  security: SecuritySchema,
  monitoring: MonitoringSchema,
}).strict();

// Export types
export type HomelabConfig = z.infer<typeof HomelabConfigSchema>;
export type HardwareConfig = z.infer<typeof HardwareSchema>;
export type ServiceConfig = z.infer<typeof ServiceToggleSchema>;
export type NetworksConfig = z.infer<typeof NetworksSchema>;
export type ServicesConfig = z.infer<typeof ServicesSchema>;
export type IntegrationsConfig = z.infer<typeof IntegrationsSchema>;
export type SecurityConfig = z.infer<typeof SecuritySchema>;
export type MonitoringConfig = z.infer<typeof MonitoringSchema>;

// Validation helpers
export const validateConfig = (data: unknown): HomelabConfig => {
  return HomelabConfigSchema.parse(data);
};

export const validateConfigSafe = (data: unknown) => {
  return HomelabConfigSchema.safeParse(data);
};