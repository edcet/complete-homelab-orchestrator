export interface OlaresConfig {
  hardware: { r240: { ip: string; proxmox_port?: number; node_name?: string; storage_id?: string } };
  networks: { primary: { bridge?: string; vlan?: number; gateway?: string; nameservers?: string[] } };
  services: { olares: { enabled?: boolean; name?: string; vm_id?: number; cores?: number; memory?: number|string; disk_gb?: number; os?: { isoId?: string }; domain?: string } };
}
