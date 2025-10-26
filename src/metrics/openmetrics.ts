/**
 * OpenMetrics format implementation for Pangolin ecosystem
 * Compliant with OpenMetrics specification
 */

export interface MetricSample {
  name: string;
  labels?: Record<string, string>;
  value: number;
  timestamp?: number;
}

export interface MetricFamily {
  name: string;
  type: 'counter' | 'gauge' | 'histogram' | 'summary' | 'info' | 'stateset';
  help: string;
  unit?: string;
  samples: MetricSample[];
}

export class OpenMetricsExporter {
  private families: Map<string, MetricFamily> = new Map();
  private commonLabels: Record<string, string> = {};
  
  constructor(commonLabels?: Record<string, string>) {
    this.commonLabels = commonLabels || {};
  }

  /**
   * Add a counter metric
   */
  public addCounter(
    name: string,
    help: string,
    value: number,
    labels?: Record<string, string>,
    unit?: string
  ): void {
    this.addMetric('counter', name, help, value, labels, unit);
  }

  /**
   * Add a gauge metric
   */
  public addGauge(
    name: string,
    help: string,
    value: number,
    labels?: Record<string, string>,
    unit?: string
  ): void {
    this.addMetric('gauge', name, help, value, labels, unit);
  }

  /**
   * Add a histogram metric
   */
  public addHistogram(
    name: string,
    help: string,
    buckets: { le: number; count: number }[],
    sum: number,
    count: number,
    labels?: Record<string, string>,
    unit?: string
  ): void {
    const baseName = name.endsWith('_bucket') ? name.slice(0, -7) : name;
    
    // Add bucket samples
    const bucketSamples: MetricSample[] = buckets.map(bucket => ({
      name: `${baseName}_bucket`,
      labels: { ...labels, le: bucket.le.toString() },
      value: bucket.count,
      timestamp: Date.now()
    }));
    
    // Add sum and count
    bucketSamples.push(
      {
        name: `${baseName}_sum`,
        labels,
        value: sum,
        timestamp: Date.now()
      },
      {
        name: `${baseName}_count`,
        labels,
        value: count,
        timestamp: Date.now()
      }
    );
    
    const family: MetricFamily = {
      name: baseName,
      type: 'histogram',
      help,
      unit,
      samples: bucketSamples
    };
    
    this.families.set(baseName, family);
  }

  /**
   * Export metrics in OpenMetrics format
   */
  public export(): string {
    const lines: string[] = [];
    
    // Add OpenMetrics header
    lines.push('# HELP pangolin_info Information about Pangolin ecosystem');
    lines.push('# TYPE pangolin_info info');
    lines.push('# UNIT pangolin_info info');
    
    const infoLabels = {
      version: '2.2.0',
      ecosystem: 'complete',
      components: 'pangolin,newt,gerbil,badger,olm',
      ...this.commonLabels
    };
    
    lines.push(`pangolin_info${this.formatLabels(infoLabels)} 1`);
    lines.push('');
    
    // Export all metric families
    for (const [name, family] of this.families.entries()) {
      lines.push(`# HELP ${name} ${family.help}`);
      lines.push(`# TYPE ${name} ${family.type}`);
      
      if (family.unit) {
        lines.push(`# UNIT ${name} ${family.unit}`);
      }
      
      // Add samples
      for (const sample of family.samples) {
        const labels = { ...this.commonLabels, ...sample.labels };
        const timestamp = sample.timestamp ? ` ${sample.timestamp}` : '';
        lines.push(`${sample.name}${this.formatLabels(labels)} ${sample.value}${timestamp}`);
      }
      
      lines.push('');
    }
    
    // Add EOF marker
    lines.push('# EOF');
    
    return lines.join('\n');
  }

  /**
   * Clear all metrics
   */
  public clear(): void {
    this.families.clear();
  }

  /**
   * Get metrics count
   */
  public getMetricsCount(): number {
    return Array.from(this.families.values())
      .reduce((total, family) => total + family.samples.length, 0);
  }

  private addMetric(
    type: MetricFamily['type'],
    name: string,
    help: string,
    value: number,
    labels?: Record<string, string>,
    unit?: string
  ): void {
    let family = this.families.get(name);
    
    if (!family) {
      family = {
        name,
        type,
        help,
        unit,
        samples: []
      };
      this.families.set(name, family);
    }
    
    family.samples.push({
      name,
      labels,
      value,
      timestamp: Date.now()
    });
  }

  private formatLabels(labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) {
      return '';
    }
    
    const pairs = Object.entries(labels)
      .map(([key, value]) => `${key}="${this.escapeLabel(value)}"`)
      .join(',');
    
    return `{${pairs}}`;
  }

  private escapeLabel(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t');
  }
}