import * as pulumi from "@pulumi/pulumi";
import * as proxmoxve from "@muhlba91/pulumi-proxmoxve";
import { createOlares } from "./proxmox-provider";
import { OlaresConfig } from "./types";

const config = new pulumi.Config();
const homelab = config.requireObject<any>("homelab");
const escSecrets = new pulumi.Config("secrets");

const proxmoxProvider = new proxmoxve.Provider("proxmox", {
  endpoint: `https://${homelab.hardware.r240.ip}:${homelab.hardware.r240.proxmox_port || 8006}/api2/json`,
  username: "root@pam",
  password: escSecrets.requireSecret("proxmox-password"),
  insecure: true,
});

export const olares = createOlares("olares", homelab as OlaresConfig, { provider: proxmoxProvider });
