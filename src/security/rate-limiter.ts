import { createHash } from 'crypto';

export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
  burstSize: number; // Burst allowance
  keyGenerator?: (clientId: string) => string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
}

export interface ClientMetrics {
  requests: number;
  windowStart: number;
  tokens: number;
  lastRefill: number;
}

/**
 * Advanced rate limiter with sliding window + token bucket
 * Implements per-client rate limiting with burst handling
 */
export class RateLimiter {
  private config: RateLimitConfig;
  private clients: Map<string, ClientMetrics> = new Map();
  private cleanupInterval: NodeJS.Timeout;
  
  constructor(config: RateLimitConfig) {
    this.config = {
      keyGenerator: (clientId: string) => this.hashClientId(clientId),
      ...config
    };
    
    // Cleanup expired windows every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60 * 1000);
  }

  /**
   * Check if request is allowed for client
   */
  public checkLimit(clientId: string): RateLimitResult {
    const key = this.config.keyGenerator!(clientId);
    const now = Date.now();
    const client = this.getOrCreateClient(key, now);
    
    // Refill tokens (token bucket)
    this.refillTokens(client, now);
    
    // Check sliding window
    const windowStart = now - this.config.windowMs;
    if (client.windowStart < windowStart) {
      // Reset window
      client.requests = 0;
      client.windowStart = now;
    }
    
    // Check limits
    const allowed = client.requests < this.config.maxRequests && client.tokens > 0;
    
    if (allowed) {
      client.requests++;
      client.tokens--;
    }
    
    const remaining = Math.max(0, this.config.maxRequests - client.requests);
    const resetTime = client.windowStart + this.config.windowMs;
    
    return {
      allowed,
      remaining,
      resetTime,
      retryAfter: allowed ? undefined : Math.ceil((resetTime - now) / 1000)
    };
  }

  /**
   * Get rate limit status for client (without consuming)
   */
  public getStatus(clientId: string): RateLimitResult {
    const key = this.config.keyGenerator!(clientId);
    const client = this.clients.get(key);
    const now = Date.now();
    
    if (!client) {
      return {
        allowed: true,
        remaining: this.config.maxRequests,
        resetTime: now + this.config.windowMs
      };
    }
    
    const remaining = Math.max(0, this.config.maxRequests - client.requests);
    const resetTime = client.windowStart + this.config.windowMs;
    
    return {
      allowed: remaining > 0 && client.tokens > 0,
      remaining,
      resetTime,
      retryAfter: remaining === 0 ? Math.ceil((resetTime - now) / 1000) : undefined
    };
  }

  /**
   * Reset limits for a client (admin function)
   */
  public resetClient(clientId: string): void {
    const key = this.config.keyGenerator!(clientId);
    this.clients.delete(key);
  }

  /**
   * Get metrics for all clients
   */
  public getMetrics(): Record<string, ClientMetrics & { clientId: string }> {
    const metrics: Record<string, ClientMetrics & { clientId: string }> = {};
    
    for (const [key, client] of this.clients.entries()) {
      metrics[key] = {
        ...client,
        clientId: key.substring(0, 8) // Only show hash prefix for privacy
      };
    }
    
    return metrics;
  }

  /**
   * Cleanup expired client data
   */
  private cleanup(): void {
    const now = Date.now();
    const expiredThreshold = now - (this.config.windowMs * 2); // Keep 2 windows
    
    for (const [key, client] of this.clients.entries()) {
      if (client.windowStart < expiredThreshold) {
        this.clients.delete(key);
      }
    }
  }

  /**
   * Get or create client metrics
   */
  private getOrCreateClient(key: string, now: number): ClientMetrics {
    let client = this.clients.get(key);
    
    if (!client) {
      client = {
        requests: 0,
        windowStart: now,
        tokens: this.config.burstSize,
        lastRefill: now
      };
      this.clients.set(key, client);
    }
    
    return client;
  }

  /**
   * Refill token bucket
   */
  private refillTokens(client: ClientMetrics, now: number): void {
    const timeSinceLastRefill = now - client.lastRefill;
    const refillRate = this.config.burstSize / this.config.windowMs; // tokens per ms
    const tokensToAdd = Math.floor(timeSinceLastRefill * refillRate);
    
    if (tokensToAdd > 0) {
      client.tokens = Math.min(
        this.config.burstSize,
        client.tokens + tokensToAdd
      );
      client.lastRefill = now;
    }
  }

  /**
   * Hash client ID for privacy
   */
  private hashClientId(clientId: string): string {
    return createHash('sha256')
      .update(clientId + process.env.RATE_LIMIT_SALT || 'homelab-salt')
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Destroy rate limiter and cleanup
   */
  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.clients.clear();
  }
}