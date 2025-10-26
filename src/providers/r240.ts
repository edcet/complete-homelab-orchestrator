import { HomelabConfig } from "../types/schemas";
import { redfishReset, redfishPowerStatus } from "./idrac";
import { waitForProxmoxUI, proxmoxStatus } from "./proxmox";

export async function bootstrapR240(cfg: HomelabConfig): Promise<void> {
  const { r240 } = cfg.hardware;
  const idracUser = r240.idrac_user;
  const idracPass = process.env.IDRAC_PASSWORD;
  
  if (!idracPass) {
    throw new Error("IDRAC_PASSWORD environment variable required");
  }

  console.log(`🔌 Checking R240 power status (iDRAC: ${r240.idrac_ip})...`);
  
  try {
    const powerState = await redfishPowerStatus(r240.idrac_ip, idracUser, idracPass);
    console.log(`⚡ Current power state: ${powerState}`);
    
    if (powerState !== "On") {
      console.log("🔋 Powering on R240 via iDRAC...");
      await redfishReset(r240.idrac_ip, idracUser, idracPass, "On");
      console.log("✅ Power-on command sent");
      
      // Wait for boot sequence
      console.log("⏳ Waiting for boot sequence (120s)...");
      await new Promise(resolve => setTimeout(resolve, 120000));
    }
    
    console.log(`🌐 Waiting for Proxmox UI (${r240.ip}:${r240.proxmox_port || 8006})...`);
    await waitForProxmoxUI({ 
      host: r240.ip, 
      port: r240.proxmox_port || 8006 
    }, 300);
    
    console.log("📊 Verifying Proxmox status...");
    const pveStatus = await proxmoxStatus({
      host: r240.ip,
      port: r240.proxmox_port || 8006
    });
    
    console.log(`✅ Proxmox status: ${pveStatus.status}`);
    console.log(`📋 Node info: ${pveStatus.version} (${pveStatus.uptime}s uptime)`);
    
    // Bootstrap core services
    console.log("🚀 Bootstrapping core homelab services...");
    await bootstrapCoreServices(cfg);
    
    console.log("✅ R240 bootstrap completed successfully!");
    
  } catch (error) {
    console.error(`❌ R240 bootstrap failed: ${error.message}`);
    throw error;
  }
}

async function bootstrapCoreServices(cfg: HomelabConfig): Promise<void> {
  const { r240 } = cfg.hardware;
  
  // Deploy Docker network and core containers via SSH
  const sshCommands = [
    // Create docker network
    `ssh root@${r240.ip} "docker network create ${cfg.networks.docker_network} || true"`,
    
    // Deploy Setec vault
    `ssh root@${r240.ip} "docker run -d --name setec-vault --restart unless-stopped -p ${cfg.services.setec.port}:${cfg.services.setec.port} -v /opt/setec:${cfg.services.setec.storage_path} -e SETEC_STORAGE_TYPE=${cfg.services.setec.storage_type} --network ${cfg.networks.docker_network} setecrs/setec:latest"`,
    
    // Deploy Pangolin gateway
    `ssh root@${r240.ip} "docker run -d --name pangolin-gateway --restart unless-stopped -p 3001:3001 -p 8080:8080 -p ${cfg.networks.wireguard_port}:${cfg.networks.wireguard_port}/udp -v /var/run/docker.sock:/var/run/docker.sock --network ${cfg.networks.docker_network} --privileged fosrl/pangolin:latest"`,
    
    // Deploy Newt client
    `ssh root@${r240.ip} "docker run -d --name newt-client --restart unless-stopped -v /var/run/docker.sock:/var/run/docker.sock -e PANGOLIN_ENDPOINT=http://pangolin-gateway:3001 --network ${cfg.networks.docker_network} fosrl/newt:latest"`,
  ];
  
  for (const cmd of sshCommands) {
    console.log(`⚙️ Executing: ${cmd.split(' ').slice(0, 3).join(' ')}...`);
    const { execSync } = await import('child_process');
    try {
      execSync(cmd, { stdio: 'pipe' });
      console.log(`✅ Command completed`);
    } catch (error) {
      console.warn(`⚠️ Command failed: ${error.message}`);
    }
  }
}