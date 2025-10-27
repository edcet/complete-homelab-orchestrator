// Agent Federation Protocol for MCP
// Production-ready implementation enabling multi-agent orchestration across homelab services

import { MCPServer } from '../core/mcp-server';
import { ResourcePool } from '../core/resource-pool';

export type HealthStatus = 'active' | 'degraded' | 'offline';

export interface FederatedAgent {
  id: string;
  capabilities: string[];
  endpoint: string;
  healthStatus: HealthStatus;
  lastHeartbeat: number;
  loadAvg: number; // 0.0 - 1.0
}

export interface RouteOptions {
  timeoutMs?: number;
  preferAgents?: string[]; // agent IDs preference
  stickySessionKey?: string; // stick to same agent for a key
  requireHealthy?: boolean;
}

export interface ConsensusOptions {
  quorum?: number; // fraction 0-1 required to pass (default: >50%)
  timeoutMs?: number;
}

export class AgentFederation {
  private agents: Map<string, FederatedAgent> = new Map();
  private mcpServer: MCPServer;
  private resourcePool: ResourcePool;

  constructor(mcpServer: MCPServer, resourcePool: ResourcePool) {
    this.mcpServer = mcpServer;
    this.resourcePool = resourcePool;
  }

  // Register or update an agent in the federation
  upsertAgent(agent: Omit<FederatedAgent, 'lastHeartbeat'> & { lastHeartbeat?: number }): void {
    const existing = this.agents.get(agent.id);
    const now = Date.now();
    const normalized: FederatedAgent = {
      id: agent.id,
      capabilities: [...new Set(agent.capabilities)].sort(),
      endpoint: agent.endpoint,
      healthStatus: agent.healthStatus,
      lastHeartbeat: agent.lastHeartbeat ?? existing?.lastHeartbeat ?? now,
      loadAvg: Math.min(1, Math.max(0, agent.loadAvg)),
    };
    this.agents.set(agent.id, normalized);
  }

  removeAgent(id: string): boolean {
    return this.agents.delete(id);
  }

  listAgents(filter?: Partial<Pick<FederatedAgent, 'capabilities' | 'healthStatus'>>): FederatedAgent[] {
    let list = Array.from(this.agents.values());
    if (filter?.healthStatus) list = list.filter(a => a.healthStatus === filter.healthStatus);
    if (filter?.capabilities?.length) {
      list = list.filter(a => filter!.capabilities!.every(c => a.capabilities.includes(c)));
    }
    return list.sort((a, b) => a.id.localeCompare(b.id));
  }

  heartbeat(id: string, update?: Partial<Pick<FederatedAgent, 'healthStatus' | 'loadAvg'>>): void {
    const agent = this.agents.get(id);
    if (!agent) return;
    agent.lastHeartbeat = Date.now();
    if (typeof update?.healthStatus !== 'undefined') agent.healthStatus = update.healthStatus!;
    if (typeof update?.loadAvg !== 'undefined') agent.loadAvg = Math.min(1, Math.max(0, update.loadAvg!));
  }

  // Select agent with capability using least-load and health gating
  selectAgent(capability: string, opts?: RouteOptions): FederatedAgent | null {
    const requireHealthy = opts?.requireHealthy ?? true;
    const eligible = Array.from(this.agents.values()).filter(a => a.capabilities.includes(capability));
    const healthy = requireHealthy ? eligible.filter(a => a.healthStatus === 'active') : eligible;
    if (!healthy.length) return null;

    // sticky session by key
    if (opts?.stickySessionKey) {
      const idx = this.stableHash(opts.stickySessionKey) % healthy.length;
      return healthy[idx];
    }

    // prefer listed agents if available
    if (opts?.preferAgents?.length) {
      const preferred = healthy.filter(a => opts.preferAgents!.includes(a.id));
      if (preferred.length) return preferred.sort((a, b) => a.loadAvg - b.loadAvg)[0];
    }

    // least-load
    return healthy.sort((a, b) => a.loadAvg - b.loadAvg)[0];
  }

  async routeRequest<T = unknown>(capability: string, payload: any, opts?: RouteOptions): Promise<T> {
    const agent = this.selectAgent(capability, opts);
    if (!agent) throw new Error(`No agent available for capability: ${capability}`);

    const timeoutMs = opts?.timeoutMs ?? 30_000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${agent.endpoint}/mcp/${encodeURIComponent(capability)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ payload }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Agent ${agent.id} responded ${res.status}`);
      const data = (await res.json()) as T;
      // micro feedback loop: adjust load weight on success
      agent.loadAvg = Math.max(0, Math.min(1, agent.loadAvg * 0.9));
      return data;
    } catch (err) {
      // penalize load and mark degraded on errors
      agent.loadAvg = Math.min(1, agent.loadAvg + 0.2);
      agent.healthStatus = 'degraded';
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  // Fan-out and reach consensus across agents that have the capability
  async reachConsensus<T = unknown>(capability: string, proposal: any, opts?: ConsensusOptions): Promise<{
    decided: boolean;
    decisions: Array<{ agentId: string; ok: boolean; value?: T; error?: string }>;
  }> {
    const candidates = this.listAgents({ capabilities: [capability], healthStatus: 'active' });
    if (!candidates.length) return { decided: false, decisions: [] };

    const timeoutMs = opts?.timeoutMs ?? 20_000;
    const quorumFrac = typeof opts?.quorum === 'number' ? opts!.quorum! : 0.5;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const results = await Promise.allSettled(
        candidates.map(async (agent) => {
          const res = await fetch(`${agent.endpoint}/mcp/consensus/${encodeURIComponent(capability)}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ proposal }),
            signal: controller.signal,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = (await res.json()) as T;
          agent.loadAvg = Math.max(0, Math.min(1, agent.loadAvg * 0.95));
          return { agentId: agent.id, ok: true as const, value: data };
        })
      );

      const decisions = results.map((r, i) =>
        r.status === 'fulfilled'
          ? r.value
          : { agentId: candidates[i].id, ok: false as const, error: (r as PromiseRejectedResult).reason?.message ?? 'error' }
      );

      const okCount = decisions.filter(d => d.ok).length;
      const decided = okCount / candidates.length > quorumFrac;
      return { decided, decisions };
    } finally {
      clearTimeout(timer);
    }
  }

  // Background health monitoring tick; call on interval from scheduler
  monitorTick(now = Date.now()): void {
    const offlineThreshold = 60_000; // 60s
    for (const agent of this.agents.values()) {
      if (now - agent.lastHeartbeat > offlineThreshold) agent.healthStatus = 'offline';
      // gentle decay of load toward baseline
      agent.loadAvg = Math.max(0, agent.loadAvg * 0.98 - 0.01);
    }
  }

  private stableHash(input: string): number {
    let h = 2166136261;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return h >>> 0;
  }
}
