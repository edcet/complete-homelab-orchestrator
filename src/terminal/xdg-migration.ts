import * as command from '@pulumi/command';
import { ComponentResource } from '@pulumi/pulumi';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface XDGMigrationConfig {
  shells: ('zsh' | 'bash' | 'fish')[];
  terminals: ('alacritty' | 'kitty' | 'wezterm' | 'iterm2')[];
  deduplicationEnabled: boolean;
  backupEnabled: boolean;
  syncEnabled: boolean;
}

/**
 * XDG Base Directory Migration
 * Migrates shell configurations to XDG compliance with deduplication
 */
export class XDGConfigMigration {
  private config: XDGMigrationConfig;
  private parent: ComponentResource;
  private xdgDirs: {
    config: string;
    data: string;
    cache: string;
    state: string;
  };
  
  constructor(config: XDGMigrationConfig, parent: ComponentResource) {
    this.config = config;
    this.parent = parent;
    
    const home = os.homedir();
    this.xdgDirs = {
      config: process.env.XDG_CONFIG_HOME || path.join(home, '.config'),
      data: process.env.XDG_DATA_HOME || path.join(home, '.local/share'),
      cache: process.env.XDG_CACHE_HOME || path.join(home, '.cache'),
      state: process.env.XDG_STATE_HOME || path.join(home, '.local/state')
    };
  }

  /**
   * Execute complete XDG migration
   */
  async executeXDGMigration(): Promise<void> {
    console.log('🔄 Starting XDG Base Directory migration...');
    
    // Create XDG directories
    await this.createXDGDirectories();
    
    // Backup existing configurations
    if (this.config.backupEnabled) {
      await this.backupExistingConfigs();
    }
    
    // Migrate shell configurations
    for (const shell of this.config.shells) {
      await this.migrateShellConfig(shell);
    }
    
    // Migrate terminal configurations
    for (const terminal of this.config.terminals) {
      await this.migrateTerminalConfig(terminal);
    }
    
    // Setup config deduplication
    if (this.config.deduplicationEnabled) {
      await this.setupConfigDeduplication();
    }
    
    // Setup synchronization
    if (this.config.syncEnabled) {
      await this.setupConfigSync();
    }
    
    console.log('✅ XDG migration completed successfully');
  }

  private async createXDGDirectories(): Promise<void> {
    const dirCreation = new command.local.Command('create-xdg-dirs', {
      create: `
        echo "📁 Creating XDG Base Directory structure..."
        
        # Create XDG directories
        mkdir -p "${this.xdgDirs.config}"
        mkdir -p "${this.xdgDirs.data}"
        mkdir -p "${this.xdgDirs.cache}"
        mkdir -p "${this.xdgDirs.state}"
        
        # Create subdirectories for applications
        mkdir -p "${this.xdgDirs.config}/shell"
        mkdir -p "${this.xdgDirs.config}/terminal"
        mkdir -p "${this.xdgDirs.data}/shell/history"
        mkdir -p "${this.xdgDirs.cache}/shell"
        mkdir -p "${this.xdgDirs.state}/shell"
        
        # Set proper permissions
        chmod 700 "${this.xdgDirs.config}"
        chmod 700 "${this.xdgDirs.data}"
        chmod 700 "${this.xdgDirs.cache}"
        chmod 700 "${this.xdgDirs.state}"
        
        echo "✅ XDG directories created"
      `
    }, { parent: this.parent });
  }

  private async backupExistingConfigs(): Promise<void> {
    const backupCreation = new command.local.Command('backup-configs', {
      create: `
        echo "💾 Backing up existing configurations..."
        
        BACKUP_DIR="$HOME/.config-backup-$(date +%Y%m%d-%H%M%S)"
        mkdir -p "$BACKUP_DIR"
        
        # Backup shell configs
        for file in ~/.bashrc ~/.bash_profile ~/.zshrc ~/.zprofile ~/.config/fish; do
            if [ -f "$file" ] || [ -d "$file" ]; then
                cp -r "$file" "$BACKUP_DIR/" 2>/dev/null || true
            fi
        done
        
        # Backup terminal configs
        for dir in ~/.config/alacritty ~/.config/kitty ~/.config/wezterm ~/Library/Preferences/com.googlecode.iterm2.plist; do
            if [ -f "$dir" ] || [ -d "$dir" ]; then
                cp -r "$dir" "$BACKUP_DIR/" 2>/dev/null || true
            fi
        done
        
        echo "✅ Configurations backed up to $BACKUP_DIR"
      `
    }, { parent: this.parent });
  }

  private async migrateShellConfig(shell: 'zsh' | 'bash' | 'fish'): Promise<void> {
    const shellMigration = new command.local.Command(`migrate-${shell}`, {
      create: this.generateShellMigrationScript(shell)
    }, { parent: this.parent });
  }

  private generateShellMigrationScript(shell: 'zsh' | 'bash' | 'fish'): string {
    const commonConfig = `
# XDG Base Directory Specification
export XDG_CONFIG_HOME="$HOME/.config"
export XDG_DATA_HOME="$HOME/.local/share"
export XDG_CACHE_HOME="$HOME/.cache"
export XDG_STATE_HOME="$HOME/.local/state"

# Homelab integration
export HOMELAB_CONFIG="$XDG_CONFIG_HOME/homelab/config.yaml"
export HOMELAB_DATA_DIR="$XDG_DATA_HOME/homelab"
export HOMELAB_CACHE_DIR="$XDG_CACHE_HOME/homelab"

# Tool configurations
export DOCKER_CONFIG="$XDG_CONFIG_HOME/docker"
export KUBE_CONFIG_PATH="$XDG_CONFIG_HOME/kube"
export AWS_CONFIG_FILE="$XDG_CONFIG_HOME/aws/config"
export AWS_SHARED_CREDENTIALS_FILE="$XDG_CONFIG_HOME/aws/credentials"

# Development tools
export CARGO_HOME="$XDG_DATA_HOME/cargo"
export RUSTUP_HOME="$XDG_DATA_HOME/rustup"
export GOPATH="$XDG_DATA_HOME/go"
export NPM_CONFIG_USERCONFIG="$XDG_CONFIG_HOME/npm/npmrc"
`;

    switch (shell) {
      case 'zsh':
        return `
          echo "🐚 Migrating Zsh configuration to XDG..."
          
          # Create Zsh config directory
          mkdir -p "${this.xdgDirs.config}/zsh"
          
          # Create main zshrc
          cat > "${this.xdgDirs.config}/zsh/.zshrc" << 'EOF'
${commonConfig}

# Zsh-specific XDG compliance
export ZDOTDIR="$XDG_CONFIG_HOME/zsh"
export HISTFILE="$XDG_STATE_HOME/shell/zsh_history"
export HISTSIZE=50000
export SAVEHIST=50000

# Zsh options for better history
setopt HIST_EXPIRE_DUPS_FIRST
setopt HIST_IGNORE_DUPS
setopt HIST_IGNORE_ALL_DUPS
setopt HIST_FIND_NO_DUPS
setopt HIST_SAVE_NO_DUPS
setopt HIST_REDUCE_BLANKS
setopt HIST_VERIFY
setopt SHARE_HISTORY
setopt APPEND_HISTORY
setopt INC_APPEND_HISTORY

# Homelab aliases
alias homelab="$HOME/.local/bin/homelab"
alias hl="homelab"
alias hls="homelab status"
alias hld="homelab deploy"

# Load additional configs
for config in "$ZDOTDIR"/{aliases,functions,exports,paths}; do
    [ -f "$config" ] && source "$config"
done

# Load Tailscale completion if available
command -v tailscale >/dev/null && eval "$(tailscale completion zsh)"

# Load homelab completion
command -v homelab >/dev/null && eval "$(homelab completion zsh)"
EOF

          # Update user's .zshrc to source XDG config
          echo 'export ZDOTDIR="$HOME/.config/zsh"' > ~/.zshrc
          echo '[ -f "$ZDOTDIR/.zshrc" ] && source "$ZDOTDIR/.zshrc"' >> ~/.zshrc
          
          echo "✅ Zsh migration completed"
        `;
        
      case 'bash':
        return `
          echo "🐚 Migrating Bash configuration to XDG..."
          
          mkdir -p "${this.xdgDirs.config}/bash"
          
          cat > "${this.xdgDirs.config}/bash/.bashrc" << 'EOF'
${commonConfig}

# Bash-specific XDG compliance
export HISTFILE="$XDG_STATE_HOME/shell/bash_history"
export HISTSIZE=50000
export HISTFILESIZE=50000
export HISTCONTROL=ignoredups:erasedups

# Bash options
shopt -s histappend
shopt -s checkwinsize

# Homelab aliases
alias homelab="$HOME/.local/bin/homelab"
alias hl="homelab"
alias hls="homelab status"
alias hld="homelab deploy"

# Load completion
[ -f /usr/share/bash-completion/bash_completion ] && . /usr/share/bash-completion/bash_completion
command -v homelab >/dev/null && eval "$(homelab completion bash)"
EOF

          # Update .bashrc
          echo '[ -f "$HOME/.config/bash/.bashrc" ] && source "$HOME/.config/bash/.bashrc"' > ~/.bashrc
          
          echo "✅ Bash migration completed"
        `;
        
      case 'fish':
        return `
          echo "🐠 Migrating Fish configuration to XDG..."
          
          mkdir -p "${this.xdgDirs.config}/fish/conf.d"
          
          cat > "${this.xdgDirs.config}/fish/config.fish" << 'EOF'
# Fish XDG compliance (built-in)
set -gx XDG_CONFIG_HOME $HOME/.config
set -gx XDG_DATA_HOME $HOME/.local/share
set -gx XDG_CACHE_HOME $HOME/.cache
set -gx XDG_STATE_HOME $HOME/.local/state

# Homelab integration
set -gx HOMELAB_CONFIG $XDG_CONFIG_HOME/homelab/config.yaml
set -gx HOMELAB_DATA_DIR $XDG_DATA_HOME/homelab
set -gx HOMELAB_CACHE_DIR $XDG_CACHE_HOME/homelab

# Aliases
abbr homelab '$HOME/.local/bin/homelab'
abbr hl homelab
abbr hls 'homelab status'
abbr hld 'homelab deploy'

# History settings
set -g fish_history_file $XDG_STATE_HOME/shell/fish_history
EOF

          echo "✅ Fish migration completed"
        `;
    }
  }

  private async migrateTerminalConfig(terminal: string): Promise<void> {
    const terminalMigration = new command.local.Command(`migrate-${terminal}`, {
      create: this.generateTerminalMigrationScript(terminal)
    }, { parent: this.parent });
  }

  private generateTerminalMigrationScript(terminal: string): string {
    switch (terminal) {
      case 'alacritty':
        return `
          echo "💻 Migrating Alacritty configuration..."
          
          mkdir -p "${this.xdgDirs.config}/alacritty"
          
          cat > "${this.xdgDirs.config}/alacritty/alacritty.yml" << 'EOF'
# Alacritty XDG-compliant configuration
env:
  TERM: xterm-256color

window:
  padding:
    x: 10
    y: 10
  decorations: buttonless
  startup_mode: Windowed
  title: Homelab Terminal
  class:
    instance: Alacritty
    general: Alacritty

scrolling:
  history: 50000
  multiplier: 3

font:
  normal:
    family: 'FiraCode Nerd Font'
    style: Regular
  bold:
    family: 'FiraCode Nerd Font'
    style: Bold
  italic:
    family: 'FiraCode Nerd Font'
    style: Italic
  size: 14.0

colors:
  primary:
    background: '#1e1e2e'
    foreground: '#cdd6f4'
  cursor:
    text: '#1e1e2e'
    cursor: '#f5e0dc'
  selection:
    text: '#1e1e2e'
    background: '#f5e0dc'

key_bindings:
  - { key: V, mods: Command, action: Paste }
  - { key: C, mods: Command, action: Copy }
  - { key: N, mods: Command, action: SpawnNewInstance }
  - { key: Plus, mods: Command, action: IncreaseFontSize }
  - { key: Minus, mods: Command, action: DecreaseFontSize }
  - { key: Key0, mods: Command, action: ResetFontSize }
EOF
          
          echo "✅ Alacritty configuration migrated"
        `;
        
      case 'kitty':
        return `
          echo "🐱 Migrating Kitty configuration..."
          
          mkdir -p "${this.xdgDirs.config}/kitty"
          
          cat > "${this.xdgDirs.config}/kitty/kitty.conf" << 'EOF'
# Kitty XDG-compliant configuration

# Font configuration
font_family FiraCode Nerd Font
bold_font auto
italic_font auto
bold_italic_font auto
font_size 14.0

# Window settings
remember_window_size no
initial_window_width 1200
initial_window_height 800
window_padding_width 10

# Terminal features
scrollback_lines 50000
wheel_scroll_multiplier 3.0
click_interval 0.5

# Theme
foreground #cdd6f4
background #1e1e2e
selection_foreground #1e1e2e
selection_background #f5e0dc

# Cursor
cursor #f5e0dc
cursor_text_color #1e1e2e
cursor_shape block
cursor_blink_interval 0

# URL handling
open_url_with default
url_color #89b4fa
url_style curly

# Performance
repaint_delay 10
input_delay 3
sync_to_monitor yes

# Key mappings
map cmd+c copy_to_clipboard
map cmd+v paste_from_clipboard
map cmd+n new_os_window
map cmd+plus increase_font_size
map cmd+minus decrease_font_size
map cmd+0 restore_font_size
EOF
          
          echo "✅ Kitty configuration migrated"
        `;
        
      default:
        return `echo "⚠️ Terminal ${terminal} migration not implemented"`;
    }
  }

  private async setupConfigDeduplication(): Promise<void> {
    const deduplicationSetup = new command.local.Command('config-deduplication', {
      create: `
        echo "🔗 Setting up configuration deduplication..."
        
        # Create common configuration directory
        mkdir -p "${this.xdgDirs.config}/common"
        
        # Create common aliases file
        cat > "${this.xdgDirs.config}/common/aliases" << 'EOF'
# Common aliases for all shells

# Homelab shortcuts
alias homelab="$HOME/.local/bin/homelab"
alias hl="homelab"
alias hls="homelab status"
alias hld="homelab deploy --preview"
alias hldr="homelab deploy"
alias hlv="homelab validate"
alias hlr="homelab r240:bootstrap"

# Docker shortcuts
alias d="docker"
alias dc="docker compose"
alias dcu="docker compose up -d"
alias dcd="docker compose down"
alias dcl="docker compose logs -f"

# Kubernetes shortcuts
alias k="kubectl"
alias kg="kubectl get"
alias kd="kubectl describe"
alias kl="kubectl logs -f"
alias ka="kubectl apply -f"

# System shortcuts
alias ll="ls -la"
alias la="ls -la"
alias ..="cd .."
alias ...="cd ../.."
alias grep="grep --color=auto"

# Git shortcuts
alias g="git"
alias gs="git status"
alias ga="git add"
alias gc="git commit"
alias gp="git push"
alias gl="git pull"
alias gd="git diff"
EOF

        # Create common functions file
        cat > "${this.xdgDirs.config}/common/functions" << 'EOF'
# Common functions for all shells

# Homelab deployment with confirmation
homelab_deploy_safe() {
    echo "🚀 Running homelab deployment preview..."
    homelab deploy --preview -c "\${HOMELAB_CONFIG:-examples/advanced/homelab.yaml}"
    
    echo -n "Proceed with deployment? [y/N]: "
    read -r response
    
    case "$response" in
        [yY][eE][sS]|[yY])
            echo "✅ Deploying homelab..."
            homelab deploy -c "\${HOMELAB_CONFIG:-examples/advanced/homelab.yaml}"
            ;;
        *)
            echo "❌ Deployment cancelled"
            ;;
    esac
}

# Quick status check
homelab_status() {
    echo "📊 Homelab Status:"
    homelab status -c "\${HOMELAB_CONFIG:-examples/advanced/homelab.yaml}"
    
    echo "\n🔗 Tailscale Status:"
    homelab tailscale status
    
    echo "\n🛡️ AdGuard Status:"
    homelab adguard status
}
EOF

        # Create symlinks for shell-specific configs
        for shell_dir in "${this.xdgDirs.config}"/*/; do
            shell_name="$(basename "$shell_dir")"
            if [ "$shell_name" != "common" ]; then
                ln -sf "../common/aliases" "$shell_dir/aliases" 2>/dev/null || true
                ln -sf "../common/functions" "$shell_dir/functions" 2>/dev/null || true
            fi
        done
        
        echo "✅ Configuration deduplication setup complete"
      `
    }, { parent: this.parent });
  }

  private async setupConfigSync(): Promise<void> {
    const syncSetup = new command.local.Command('config-sync', {
      create: `
        echo "☁️ Setting up configuration synchronization..."
        
        # Create sync script
        cat > "$HOME/.local/bin/config-sync" << 'EOF'
#!/bin/bash
# Configuration Synchronization Script

SYNC_DIR="$XDG_CONFIG_HOME"
REMOTE_REPO="\${CONFIG_SYNC_REPO:-git@github.com:$USER/dotfiles.git}"
LOCAL_REPO="$HOME/.dotfiles"

sync_to_remote() {
    echo "📤 Syncing configs to remote repository..."
    
    if [ ! -d "$LOCAL_REPO" ]; then
        git clone "$REMOTE_REPO" "$LOCAL_REPO" 2>/dev/null || {
            echo "⚠️  Remote repository not found. Creating local git repo..."
            mkdir -p "$LOCAL_REPO"
            cd "$LOCAL_REPO"
            git init
        }
    fi
    
    cd "$LOCAL_REPO"
    
    # Copy current configs
    rsync -av --exclude='.git' "$SYNC_DIR/" ./config/
    
    # Commit changes
    git add .
    git commit -m "Config sync: $(date '+%Y-%m-%d %H:%M:%S')" 2>/dev/null || echo "No changes to commit"
    
    # Push if remote exists
    git push origin main 2>/dev/null || echo "⚠️  Push failed or no remote configured"
}

sync_from_remote() {
    echo "📥 Syncing configs from remote repository..."
    
    if [ -d "$LOCAL_REPO" ]; then
        cd "$LOCAL_REPO"
        git pull origin main 2>/dev/null || echo "⚠️  Pull failed"
        
        # Copy to local config
        rsync -av ./config/ "$SYNC_DIR/"
        
        echo "✅ Configs synced from remote"
    else
        echo "❌ Local repository not found. Run 'config-sync push' first."
    fi
}

case "$1" in
    push)
        sync_to_remote
        ;;
    pull)
        sync_from_remote
        ;;
    *)
        echo "Usage: config-sync {push|pull}"
        echo "  push: Sync local configs to remote"
        echo "  pull: Sync remote configs to local"
        exit 1
        ;;
esac
EOF

        chmod +x "$HOME/.local/bin/config-sync"
        
        # Create periodic sync service (macOS)
        if [[ "$OSTYPE" == "darwin"* ]]; then
            cat > "/tmp/com.homelab.config-sync.plist" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.homelab.config-sync</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/$(whoami)/.local/bin/config-sync</string>
        <string>push</string>
    </array>
    <key>StartInterval</key>
    <integer>3600</integer>
    <key>RunAtLoad</key>
    <false/>
</dict>
</plist>
EOF
            
            cp "/tmp/com.homelab.config-sync.plist" "$HOME/Library/LaunchAgents/"
            launchctl load "$HOME/Library/LaunchAgents/com.homelab.config-sync.plist"
        fi
        
        echo "✅ Configuration sync setup complete"
        echo "📝 To enable remote sync, set CONFIG_SYNC_REPO environment variable"
      `
    }, { parent: this.parent });
  }

  /**
   * Get migration status
   */
  async getMigrationStatus(): Promise<any> {
    return {
      xdg_directories: {
        config: fs.existsSync(this.xdgDirs.config),
        data: fs.existsSync(this.xdgDirs.data),
        cache: fs.existsSync(this.xdgDirs.cache),
        state: fs.existsSync(this.xdgDirs.state)
      },
      migrated_shells: this.config.shells.filter(shell => 
        fs.existsSync(path.join(this.xdgDirs.config, shell))
      ),
      migrated_terminals: this.config.terminals.filter(terminal => 
        fs.existsSync(path.join(this.xdgDirs.config, terminal))
      ),
      features: {
        deduplication: this.config.deduplicationEnabled,
        backup: this.config.backupEnabled,
        sync: this.config.syncEnabled
      },
      timestamp: new Date().toISOString()
    };
  }
}