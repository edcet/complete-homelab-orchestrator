import * as pulumi from "@pulumi/pulumi";
import * as tailscale from "@pulumi/tailscale";
import { HomelabConfig } from "../../../src/types/schemas";

const config = new pulumi.Config();
const homelabConfig: HomelabConfig = config.requireObject("homelab");
const tailscaleConfig = new pulumi.Config("tailscale");

// Tailscale provider configuration
const provider = new tailscale.Provider("tailscale", {
  apiKey: tailscaleConfig.requireSecret("api-key"),
  tailnet: tailscaleConfig.require("tailnet")
});

// Declarative ACL policy for homelab
const homelabACL = new tailscale.Acl("homelab-acl", {
  acl: JSON.stringify({
    acls: [
      {
        action: "accept",
        src: ["autogroup:admin"],
        dst: ["*:*"]
      },
      {
        action: "accept", 
        src: ["tag:homelab"],
        dst: [`tag:homelab:*`, `${homelabConfig.networks.primary_subnet}:*`]
      },
      {
        action: "accept",
        src: ["tag:pangolin"],
        dst: ["tag:service:443,80,22,3001", "tag:platform:*"]
      },
      {
        action: "accept",
        src: ["tag:newt"],
        dst: ["tag:pangolin:*"]
      },
      {
        action: "accept",
        src: ["tag:infrastructure"],
        dst: [`${homelabConfig.networks.primary_subnet}:*`]
      }
    ],
    hosts: {
      "r240": homelabConfig.hardware.r240.ip,
      "r7910": homelabConfig.hardware.r7910.ip,
      "pangolin-gateway": homelabConfig.networks.primary_subnet.replace(/0\/24$/, "1")
    },
    tagOwners: {
      "tag:homelab": ["autogroup:admin"],
      "tag:pangolin": ["autogroup:admin"],
      "tag:newt": ["autogroup:admin"],
      "tag:service": ["autogroup:admin"],
      "tag:platform": ["autogroup:admin"],
      "tag:infrastructure": ["autogroup:admin"]
    },
    autoApprovers: {
      routes: {
        [homelabConfig.networks.primary_subnet]: ["tag:homelab", "tag:pangolin"]
      },
      exitNode: ["tag:homelab"]
    }
  })
}, { provider });

// DNS nameservers for Tailscale MagicDNS
const tailscaleDNS = new tailscale.DnsNameservers("homelab-dns", {
  dns: ["100.100.100.100", "8.8.8.8"],
}, { provider });

// Export mesh configuration for downstream stacks
export const aclId = homelabACL.id;
export const tailnetDomain = tailscaleConfig.require("tailnet");
export const meshConfiguration = {
  domain: tailnetDomain,
  subnet: homelabConfig.networks.primary_subnet,
  pangolinGateway: homelabConfig.networks.primary_subnet.replace(/0\/24$/, "1"),
  dnsServers: ["100.100.100.100"]
};
export const subnetRoutes = [homelabConfig.networks.primary_subnet];