export interface CasaOSConfig {
  proxmox: {
    node: string;
    storage: string;
  };
  vm: {
    name: string;
    templateId: number;
    cores?: number;
    memory?: number;
    diskSize?: number;
  };
  network: {
    bridge?: string;
    ipAddress?: string;
    netmask?: string;
    gateway?: string;
    dns?: string[];
  };
  ssh: {
    user: string;
    publicKey: string;
    privateKey: string;
    password?: string;
  };
  apps?: Array<{
    name: string;
    image?: string;
    ports?: Record<string, string>;
    volumes?: Record<string, string>;
    environment?: Record<string, string>;
  }>;
}
