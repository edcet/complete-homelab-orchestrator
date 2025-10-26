import * as command from '@pulumi/command';
import { ComponentResource } from '@pulumi/pulumi';
import { HomelabConfig } from '../types/schemas';

export interface MacMiniGatewayConfig {
  interfaces: {
    wan1: string;  // Primary internet (ethernet)
    wan2: string;  // Backup/iPad 5G
    lan: string;   // Local network
  };
  routing: {
    loadBalancing: boolean;
    failover: {
      enabled: boolean;
      pingTargets: string[];
      failoverDelay: number;
    };
  };
  firewall: {
    enabled: boolean;
    rules: string[];
  };
}

/**
 * Mac Mini Gateway Configuration
 * Configures Mac Mini as dual-WAN gateway with iPad 5G failover
 */
export class MacMiniGateway {
  private config: HomelabConfig;
  private gatewayConfig: MacMiniGatewayConfig;
  private parent: ComponentResource;
  
  constructor(
    config: HomelabConfig,
    gatewayConfig: MacMiniGatewayConfig,
    parent: ComponentResource
  ) {
    this.config = config;
    this.gatewayConfig = gatewayConfig;
    this.parent = parent;
  }

  /**
   * Configure Mac Mini as gateway
   */
  async configureGateway(): Promise<void> {
    console.log('🖥️ Configuring Mac Mini as dual-WAN gateway...');
    
    await this.setupNetworkInterfaces();
    await this.configureRouting();
    await this.setupFirewall();
    await this.configureDHCP();
    await this.setupMonitoring();
    
    console.log('✅ Mac Mini gateway configuration complete');
  }

  private async setupNetworkInterfaces(): Promise<void> {
    const interfaceSetup = new command.local.Command('mac-mini-interfaces', {
      create: `
        echo "🔧 Configuring Mac Mini network interfaces..."
        
        # Enable IP forwarding
        sudo sysctl -w net.inet.ip.forwarding=1
        echo 'net.inet.ip.forwarding=1' | sudo tee -a /etc/sysctl.conf
        
        # Configure WAN1 interface (primary ethernet)
        sudo networksetup -setmanual "${this.gatewayConfig.interfaces.wan1}" \
          192.168.1.10 255.255.255.0 192.168.1.1
        
        # Configure WAN2 interface (iPad 5G via USB-C)
        # This assumes iPad sharing via USB-C ethernet adapter
        sudo networksetup -setmanual "${this.gatewayConfig.interfaces.wan2}" \
          192.168.2.10 255.255.255.0 192.168.2.1
        
        # Configure LAN interface (internal network)
        sudo networksetup -setmanual "${this.gatewayConfig.interfaces.lan}" \
          ${this.config.networks.primary_subnet.replace('0/24', '1')} \
          255.255.255.0
        
        # Create bridge for internal network if needed
        sudo ifconfig bridge1 create
        sudo ifconfig bridge1 addm ${this.gatewayConfig.interfaces.lan}
        sudo ifconfig bridge1 up
        
        echo "✅ Network interfaces configured"
      `
    }, { parent: this.parent });
  }

  private async configureRouting(): Promise<void> {
    const routingSetup = new command.local.Command('mac-mini-routing', {
      create: `
        echo "🛣️ Configuring dual-WAN routing..."
        
        # Install routing daemon for advanced features
        if ! command -v zebra &> /dev/null; then
            echo "Installing Quagga for advanced routing..."
            brew install quagga
        fi
        
        # Create routing configuration
        sudo mkdir -p /usr/local/etc/quagga
        
        cat > /tmp/zebra.conf << 'EOF'
!
! Zebra configuration for Mac Mini Gateway
!
hostname mac-mini-gateway
password zebra
enable password zebra
!
! Interface configuration
interface ${this.gatewayConfig.interfaces.wan1}
 description Primary WAN (Ethernet)
 ip address 192.168.1.10/24
!
interface ${this.gatewayConfig.interfaces.wan2}
 description Backup WAN (iPad 5G)
 ip address 192.168.2.10/24
!
interface ${this.gatewayConfig.interfaces.lan}
 description LAN Interface
 ip address ${this.config.networks.primary_subnet.replace('0/24', '1')}/24
!
! Default routes with metric for failover
ip route 0.0.0.0/0 192.168.1.1 10
ip route 0.0.0.0/0 192.168.2.1 20
!
! Log configuration
log file /var/log/quagga/zebra.log
!
EOF
        
        sudo cp /tmp/zebra.conf /usr/local/etc/quagga/
        sudo chown quagga:quagga /usr/local/etc/quagga/zebra.conf
        
        # Start routing daemon
        sudo brew services start quagga
        
        echo "✅ Dual-WAN routing configured"
      `
    }, { parent: this.parent });
  }

  private async setupFirewall(): Promise<void> {
    if (!this.gatewayConfig.firewall.enabled) {
      console.log('🔥 Firewall disabled, skipping configuration');
      return;
    }

    const firewallSetup = new command.local.Command('mac-mini-firewall', {
      create: `
        echo "🔥 Configuring macOS firewall..."
        
        # Enable macOS firewall
        sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate on
        sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setloggingmode on
        
        # Create pfctl configuration for advanced rules
        cat > /tmp/pf.conf << 'EOF'
#
# Mac Mini Gateway Firewall Rules
#

# Macros
wan1_if = "${this.gatewayConfig.interfaces.wan1}"
wan2_if = "${this.gatewayConfig.interfaces.wan2}" 
lan_if = "${this.gatewayConfig.interfaces.lan}"
lan_net = "${this.config.networks.primary_subnet}"

# Tables
table <rfc1918> { 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 }

# Options
set block-policy return
set loginterface $lan_if

# Normalization
scrub in all

# NAT rules
nat on $wan1_if from $lan_net to any -> ($wan1_if)
nat on $wan2_if from $lan_net to any -> ($wan2_if)

# Default deny
block all

# Allow loopback
pass quick on lo0 all

# Allow LAN to anywhere
pass out on $lan_if from $lan_if:network to any
pass in on $lan_if from $lan_net to any

# Allow established connections
pass out on { $wan1_if $wan2_if } from any to any keep state

# Allow SSH from Tailscale network
pass in on $lan_if proto tcp from 100.64.0.0/10 to any port 22

# Allow DHCP
pass in on $lan_if proto udp from any port 68 to any port 67
pass out on $lan_if proto udp from any port 67 to any port 68

# Allow ICMP for diagnostics
pass inet proto icmp all icmp-type echoreq

# Custom rules
${this.gatewayConfig.firewall.rules.join('\n')}

EOF
        
        # Load firewall rules
        sudo pfctl -f /tmp/pf.conf
        sudo pfctl -e
        
        echo "✅ Firewall configured and enabled"
      `
    }, { parent: this.parent });
  }

  private async configureDHCP(): Promise<void> {
    const dhcpSetup = new command.local.Command('mac-mini-dhcp', {
      create: `
        echo "📡 Configuring DHCP server..."
        
        # Install dnsmasq for DHCP/DNS
        if ! command -v dnsmasq &> /dev/null; then
            brew install dnsmasq
        fi
        
        # Create dnsmasq configuration
        cat > /tmp/dnsmasq.conf << 'EOF'
# Mac Mini Gateway DHCP/DNS Configuration

# Listen on LAN interface only
interface=${this.gatewayConfig.interfaces.lan}
bind-interfaces

# DHCP configuration
dhcp-range=${this.config.networks.primary_subnet.replace('0/24', '50')},${this.config.networks.primary_subnet.replace('0/24', '200')},12h
dhcp-option=3,${this.config.networks.primary_subnet.replace('0/24', '1')}  # Gateway
dhcp-option=6,1.1.1.1,100.100.100.100  # DNS servers

# Static DHCP reservations for infrastructure
dhcp-host=aa:bb:cc:dd:ee:ff,${this.config.hardware.r240.ip},r240
dhcp-host=ff:ee:dd:cc:bb:aa,${this.config.hardware.r7910.ip},r7910

# DNS configuration
domain=${this.config.domain}
expand-hosts
local=/${this.config.domain}/

# Upstream DNS with fallback
server=100.100.100.100  # Tailscale MagicDNS
server=1.1.1.1
server=1.0.0.1

# Cache settings
cache-size=1000
neg-ttl=60

# Logging
log-queries
log-dhcp
log-facility=/var/log/dnsmasq.log

EOF
        
        sudo cp /tmp/dnsmasq.conf /usr/local/etc/dnsmasq.conf
        
        # Start dnsmasq
        sudo brew services start dnsmasq
        
        echo "✅ DHCP/DNS server configured"
      `
    }, { parent: this.parent });
  }

  private async setupMonitoring(): Promise<void> {
    const monitoringSetup = new command.local.Command('mac-mini-monitoring', {
      create: `
        echo "📊 Setting up gateway monitoring..."
        
        # Create monitoring script
        cat > /usr/local/bin/gateway-monitor.sh << 'EOF'
#!/bin/bash
# Mac Mini Gateway Monitoring Script

LOG_FILE="/var/log/gateway-monitor.log"
PING_TARGETS=("8.8.8.8" "1.1.1.1" "${this.config.domain}")
WAN1_GW="192.168.1.1"
WAN2_GW="192.168.2.1"

log_message() {
    echo "$(date): $1" >> $LOG_FILE
}

# Test WAN connectivity
test_wan() {
    local gateway=$1
    local name=$2
    
    for target in "\${PING_TARGETS[@]}"; do
        if ping -c 1 -W 1000 -g $gateway $target >/dev/null 2>&1; then
            log_message "$name: Connectivity OK ($target)"
            return 0
        fi
    done
    
    log_message "$name: Connectivity FAILED"
    return 1
}

# Main monitoring loop
while true; do
    WAN1_STATUS="DOWN"
    WAN2_STATUS="DOWN"
    
    if test_wan $WAN1_GW "WAN1"; then
        WAN1_STATUS="UP"
    fi
    
    if test_wan $WAN2_GW "WAN2"; then
        WAN2_STATUS="UP"
    fi
    
    # Update routing if needed
    if [ "$WAN1_STATUS" = "DOWN" ] && [ "$WAN2_STATUS" = "UP" ]; then
        log_message "Failing over to WAN2 (iPad 5G)"
        sudo route change default 192.168.2.1
    elif [ "$WAN1_STATUS" = "UP" ] && [ "$WAN2_STATUS" = "UP" ]; then
        log_message "Both WANs up, using WAN1 (primary)"
        sudo route change default 192.168.1.1
    fi
    
    # Export metrics for Prometheus
    echo "gateway_wan1_status{interface=\"wan1\"} $([ \"$WAN1_STATUS\" = \"UP\" ] && echo 1 || echo 0)" > /tmp/gateway-metrics.prom
    echo "gateway_wan2_status{interface=\"wan2\"} $([ \"$WAN2_STATUS\" = \"UP\" ] && echo 1 || echo 0)" >> /tmp/gateway-metrics.prom
    echo "gateway_last_check{} $(date +%s)" >> /tmp/gateway-metrics.prom
    
    sleep 30
done
EOF
        
        chmod +x /usr/local/bin/gateway-monitor.sh
        
        # Create launchd service for monitoring
        cat > /tmp/com.homelab.gateway-monitor.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.homelab.gateway-monitor</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/gateway-monitor.sh</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/var/log/gateway-monitor.out</string>
    <key>StandardErrorPath</key>
    <string>/var/log/gateway-monitor.err</string>
</dict>
</plist>
EOF
        
        sudo cp /tmp/com.homelab.gateway-monitor.plist /Library/LaunchDaemons/
        sudo launchctl load /Library/LaunchDaemons/com.homelab.gateway-monitor.plist
        
        echo "✅ Gateway monitoring configured"
      `
    }, { parent: this.parent });
  }

  /**
   * Get gateway status
   */
  async getGatewayStatus(): Promise<any> {
    try {
      // Read metrics file
      const metricsContent = await fetch('file:///tmp/gateway-metrics.prom')
        .then(r => r.text())
        .catch(() => 'gateway_status{} 0');
      
      return {
        gateway: 'mac-mini',
        interfaces: this.gatewayConfig.interfaces,
        wan_status: {
          wan1: metricsContent.includes('gateway_wan1_status{interface="wan1"} 1'),
          wan2: metricsContent.includes('gateway_wan2_status{interface="wan2"} 1')
        },
        routing: {
          load_balancing: this.gatewayConfig.routing.loadBalancing,
          failover_enabled: this.gatewayConfig.routing.failover.enabled
        },
        firewall: {
          enabled: this.gatewayConfig.firewall.enabled,
          rules_count: this.gatewayConfig.firewall.rules.length
        },
        services: {
          dhcp: 'running',
          dns: 'running',
          routing: 'running',
          monitoring: 'running'
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}