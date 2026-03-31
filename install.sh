#!/usr/bin/env bash
# Revideo Server — one-click installer (Linux / macOS)
# Usage: curl -fsSL https://raw.githubusercontent.com/Match-Yang/revideo-server/main/install.sh | bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
readonly APP_NAME="revideo-server"
readonly MIN_NODE_MAJOR=22
readonly DEFAULT_INSTALL_DIR="$HOME/.revideo-server"
readonly DEFAULT_PORT=3001
readonly GITHUB_REPO="${GITHUB_REPO:-Match-Yang/revideo-server}"

# ---------------------------------------------------------------------------
# Color helpers
# ---------------------------------------------------------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { printf "${BLUE}${BOLD}==>${NC} %s\n" "$1"; }
success() { printf "${GREEN}${BOLD}==>${NC} %s\n" "$1"; }
warn()    { printf "${YELLOW}${BOLD}==>${NC} %s\n" "$1"; }
error()   { printf "${RED}${BOLD}==>${NC} %s\n" "$1"; }

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
INSTALL_DIR=""
PORT=""
VERSION="latest"
ACTION="install"
NON_INTERACTIVE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --uninstall|-u)        ACTION="uninstall"; shift ;;
    --install-dir|-d)      INSTALL_DIR="$2"; shift 2 ;;
    --port|-p)             PORT="$2"; shift 2 ;;
    --version|-v)          VERSION="$2"; shift 2 ;;
    --non-interactive|-y)  NON_INTERACTIVE=1; shift ;;
    --package|-f)          PACKAGE_FILE="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --install-dir DIR   Installation directory (default: $DEFAULT_INSTALL_DIR)"
      echo "  --port PORT         Server port (default: $DEFAULT_PORT)"
      echo "  --version VERSION   Version to install (default: latest)"
      echo "  --package FILE      Use a local .tar.gz package instead of downloading"
      echo "  --non-interactive   Skip all prompts"
      echo "  --uninstall         Remove Revideo Server"
      echo "  --help              Show this help"
      exit 0
      ;;
    *) error "Unknown option: $1"; exit 1 ;;
  esac
done

INSTALL_DIR="${INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
PORT="${PORT:-$DEFAULT_PORT}"

# ---------------------------------------------------------------------------
# OS / Arch detection
# ---------------------------------------------------------------------------
detect_os() {
  case "$(uname -s)" in
    Linux*)  OS="linux" ;;
    Darwin*) OS="darwin" ;;
    CYGWIN*|MINGW*|MSYS*)
      error "Windows detected. Please use the PowerShell installer:"
      error "  iex (irm https://raw.githubusercontent.com/Match-Yang/revideo-server/main/install.ps1)"
      exit 1
      ;;
    *) error "Unsupported OS: $(uname -s)"; exit 1 ;;
  esac

  if [[ "$OS" == "linux" ]]; then
    if [[ -f /etc/os-release ]]; then
      # shellcheck disable=SC1091
      . /etc/os-release
      DISTRO="$ID"
    elif command -v lsb_release &>/dev/null; then
      DISTRO="$(lsb_release -si | tr '[:upper:]' '[:lower:]')"
    else
      DISTRO="unknown"
    fi
  fi
}

detect_arch() {
  local m
  m="$(uname -m)"
  case "$m" in
    x86_64|amd64)  ARCH="x64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *) error "Unsupported architecture: $m"; exit 1 ;;
  esac
}

# ---------------------------------------------------------------------------
# Prerequisite checks & installation
# ---------------------------------------------------------------------------
has_cmd() { command -v "$1" &>/dev/null; }

check_node() {
  if has_cmd node; then
    local major
    major="$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)"
    if [[ "$major" -ge "$MIN_NODE_MAJOR" ]]; then
      success "Node.js $(node -v) found"
      return 0
    fi
    warn "Node.js $(node -v) found, but >= ${MIN_NODE_MAJOR} required"
  fi
  return 1
}

install_node() {
  info "Installing Node.js ${MIN_NODE_MAJOR}..."

  if [[ "$OS" == "darwin" ]]; then
    if has_cmd brew; then
      brew install node@${MIN_NODE_MAJOR}
      brew link node@${MIN_NODE_MAJOR} --overwrite 2>/dev/null || true
    else
      error "Homebrew not found. Install it from https://brew.sh or install Node.js manually."
      exit 1
    fi
  elif [[ "$OS" == "linux" ]]; then
    case "$DISTRO" in
      ubuntu|debian)
        # Use NodeSource
        curl -fsSL https://deb.nodesource.com/setup_${MIN_NODE_MAJOR}.x | sudo -E bash -
        sudo apt-get install -y nodejs
        ;;
      fedora|rhel|centos|rocky|alma)
        curl -fsSL https://rpm.nodesource.com/setup_${MIN_NODE_MAJOR}.x | sudo -E bash -
        sudo dnf install -y nodejs
        ;;
      arch|manjaro)
        sudo pacman -S --noconfirm nodejs npm
        ;;
      *)
        warn "Cannot auto-install Node.js for distro: $DISTRO"
        warn "Please install Node.js >= ${MIN_NODE_MAJOR} manually: https://nodejs.org"
        return 1
        ;;
    esac
  fi

  if check_node; then
    return 0
  fi
  error "Node.js installation failed. Please install Node.js >= ${MIN_NODE_MAJOR} manually."
  exit 1
}

ensure_node() {
  if ! check_node; then
    install_node
  fi
}

install_yt_dlp() {
  info "Installing yt-dlp..."

  # Always download binary directly — faster and more reliable than brew/apt
  local bindir="$HOME/.local/bin"
  mkdir -p "$bindir"

  local url="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
  # Try China mirror if GitHub is unreachable
  if ! curl -fsSL --connect-timeout 5 "https://github.com" &>/dev/null; then
    url="https://ghfast.top/https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
  fi

  curl -fsSL "$url" -o "$bindir/yt-dlp"
  chmod +x "$bindir/yt-dlp"

  # Ensure bindir is in PATH
  if [[ ":$PATH:" != *":$bindir:"* ]]; then
    export PATH="$bindir:$PATH"
    grep -q '.local/bin' "$HOME/.bashrc" 2>/dev/null || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
    grep -q '.local/bin' "$HOME/.zshrc" 2>/dev/null || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.zshrc"
  fi

  success "yt-dlp installed to $bindir/yt-dlp"
}

ensure_yt_dlp() {
  if has_cmd yt-dlp; then
    success "yt-dlp found ($(yt-dlp --version 2>/dev/null || echo 'unknown version'))"
    return
  fi
  install_yt_dlp
}

install_ffmpeg() {
  info "Installing ffmpeg (static binary)..."

  local bindir="$HOME/.local/bin"
  mkdir -p "$bindir"

  # Download pre-built static ffmpeg binaries — no compilation needed
  if [[ "$OS" == "darwin" ]]; then
    # evermeet.cx hosts official macOS static builds
    local base="https://evermeet.cx/ffmpeg/getrelease"
    local fftmp
    fftmp="$(mktemp -d)"

    curl -fsSL "${base}/ffmpeg/zip" -o "${fftmp}/ffmpeg.zip" || { error "ffmpeg download failed"; rm -rf "$fftmp"; exit 1; }
    unzip -o -q "${fftmp}/ffmpeg.zip" -d "${fftmp}/ffmpeg-out" || { error "ffmpeg unzip failed"; rm -rf "$fftmp"; exit 1; }
    mv "${fftmp}/ffmpeg-out/ffmpeg" "$bindir/ffmpeg" || { error "ffmpeg mv failed"; rm -rf "$fftmp"; exit 1; }

    curl -fsSL "${base}/ffprobe/zip" -o "${fftmp}/ffprobe.zip" || { error "ffprobe download failed"; rm -rf "$fftmp"; exit 1; }
    unzip -o -q "${fftmp}/ffprobe.zip" -d "${fftmp}/ffprobe-out" || { error "ffprobe unzip failed"; rm -rf "$fftmp"; exit 1; }
    mv "${fftmp}/ffprobe-out/ffprobe" "$bindir/ffprobe" || { error "ffprobe mv failed"; rm -rf "$fftmp"; exit 1; }

    rm -rf "$fftmp"
  elif [[ "$OS" == "linux" ]]; then
    # BtbN provides static Linux builds on GitHub
    local arch_suffix
    case "$ARCH" in
      x64)   arch_suffix="linux64" ;;
      arm64) arch_suffix="linuxarm64" ;;
    esac
    local url="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-${arch_suffix}-gpl_shared.tar.xz"
    local fftmp
    fftmp="$(mktemp -d)"
    curl -fsSL "$url" -o "${fftmp}/ffmpeg.tar.xz"
    tar -xJf "${fftmp}/ffmpeg.tar.xz" -C "${fftmp}"
    cp "${fftmp}"/ffmpeg-master-latest-*/bin/ffmpeg "${bindir}/ffmpeg"
    cp "${fftmp}"/ffmpeg-master-latest-*/bin/ffprobe "${bindir}/ffprobe"
    rm -rf "$fftmp"
  fi

  chmod +x "$bindir/ffmpeg" "$bindir/ffprobe"

  # Ensure bindir is in PATH
  if [[ ":$PATH:" != *":$bindir:"* ]]; then
    export PATH="$bindir:$PATH"
    grep -q '.local/bin' "$HOME/.bashrc" 2>/dev/null || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
    grep -q '.local/bin' "$HOME/.zshrc" 2>/dev/null || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.zshrc"
  fi

  success "ffmpeg installed to $bindir"
}

ensure_ffmpeg() {
  if has_cmd ffmpeg && has_cmd ffprobe; then
    success "ffmpeg found ($(ffmpeg -version 2>/dev/null | head -1))"
    return
  fi
  install_ffmpeg
}

check_chrome() {
  # Check for system Chrome/Chromium
  local found=""
  case "$OS" in
    darwin)
      for p in \
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
        "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
        if [[ -x "$p" ]]; then found="$p"; break; fi
      done
      ;;
    linux)
      for cmd in google-chrome chromium chromium-browser; do
        if has_cmd "$cmd"; then found="$(command -v "$cmd")"; break; fi
      done
      ;;
  esac

  if [[ -n "$found" ]]; then
    success "Chrome/Chromium found: $found"
  else
    # Check if puppeteer has Chrome
    if [[ -f "$INSTALL_DIR/node_modules/puppeteer/.local-chromium" ]] || \
       find "$INSTALL_DIR/node_modules" -name "chrome" -type f 2>/dev/null | grep -q .; then
      success "Puppeteer bundled Chrome found"
    else
      warn "Chrome/Chromium not found. Browser-based publishing features will not work."
      warn "Install Chrome later, or run: npx puppeteer browsers install chrome"
    fi
  fi
}

# ---------------------------------------------------------------------------
# Download & extract release package
# ---------------------------------------------------------------------------
get_download_url() {
  local version="$1"
  local filename="revideo-${version}-${OS}-${ARCH}.tar.gz"
  echo "https://github.com/${GITHUB_REPO}/releases/download/${version}/${filename}"
}

get_latest_version() {
  # Follow GitHub's /releases/latest redirect — no API, no rate limits
  local url
  url="$(curl -fsSL -o /dev/null -w '%{url_effective}' \
    --connect-timeout 10 \
    "https://github.com/${GITHUB_REPO}/releases/latest" 2>/dev/null)" || true

  if [[ -n "$url" ]]; then
    local version="${url##*/}"
    if [[ -n "$version" && "$version" == v* ]]; then
      echo "$version"
      return
    fi
  fi

  error "Could not determine latest version. Specify with --version <tag>"
  exit 1
}

download_and_extract() {
  local version="$1"
  local archive=""
  local cleanup_dir=""

  # Use local package file if provided
  if [[ -n "${PACKAGE_FILE:-}" ]]; then
    if [[ ! -f "$PACKAGE_FILE" ]]; then
      error "Package file not found: $PACKAGE_FILE"
      exit 1
    fi
    archive="$PACKAGE_FILE"
    info "Using local package: $PACKAGE_FILE"
  else
    local url
    if [[ "$version" == "latest" ]]; then
      info "Fetching latest version..."
      if ! version="$(get_latest_version)"; then
        error "Failed to determine latest version."
        error "Check your network connection, or specify a version: --version v1.0.0"
        exit 1
      fi
      info "Latest version: ${version}"
    fi

    if ! url="$(get_download_url "$version")"; then
      error "Failed to resolve download URL for version ${version}"
      exit 1
    fi

    info "Downloading ${APP_NAME} ${version} for ${OS}-${ARCH}..."
    info "URL: $url"

    local tmpdir
    tmpdir="$(mktemp -d)"
    archive="${tmpdir}/revideo.tar.gz"
    cleanup_dir="$tmpdir"

    if ! curl -fSL --connect-timeout 30 --retry 2 --progress-bar "$url" -o "$archive"; then
      rm -rf "$tmpdir"
      error "Download failed. Check the URL and your network connection."
      exit 1
    fi
  fi

  info "Extracting to ${INSTALL_DIR}..."

  # If updating an existing install, backup data
  if [[ -d "$INSTALL_DIR/data" ]]; then
    local backup_dir="${INSTALL_DIR}/data.bak.$$"
    info "Backing up existing data to ${backup_dir}..."
    cp -a "$INSTALL_DIR/data" "$backup_dir"
  fi

  # Remove old install files (keep data backup)
  rm -rf "$INSTALL_DIR"
  mkdir -p "$INSTALL_DIR"

  tar -xzf "$archive" -C "$INSTALL_DIR" --strip-components=1

  # Restore data backup
  if [[ -d "${INSTALL_DIR}/data.bak.$$" ]]; then
    rm -rf "$INSTALL_DIR/data"
    mv "${INSTALL_DIR}/data.bak.$$" "$INSTALL_DIR/data"
  fi

  # Ensure data directories exist
  mkdir -p "$INSTALL_DIR/data/browser/profile"

  if [[ -n "$cleanup_dir" ]]; then
    rm -rf "$cleanup_dir"
  fi
  success "Extracted to ${INSTALL_DIR}"
}

# ---------------------------------------------------------------------------
# .env setup
# ---------------------------------------------------------------------------
setup_env() {
  if [[ -f "$INSTALL_DIR/.env" ]]; then
    success ".env already exists, keeping it"
    return
  fi

  if [[ -f "$INSTALL_DIR/.env.example" ]]; then
    cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
  fi

  # Set port
  if [[ "$PORT" != "$DEFAULT_PORT" ]]; then
    sed -i.bak "s/^REVIDEO_PORT=.*/REVIDEO_PORT=${PORT}/" "$INSTALL_DIR/.env" 2>/dev/null || \
      sed -i "s/^REVIDEO_PORT=.*/REVIDEO_PORT=${PORT}/" "$INSTALL_DIR/.env" 2>/dev/null || true
  fi

  info ".env created from template. Configure translation API in the dashboard settings."
}

# ---------------------------------------------------------------------------
# Service setup
# ---------------------------------------------------------------------------
setup_service_systemd() {
  info "Installing systemd service..."

  local node_bin
  node_bin="$(command -v node)"

  local service_file="/etc/systemd/system/${APP_NAME}.service"
  local template="$INSTALL_DIR/scripts/systemd/${APP_NAME}.service"

  if [[ ! -f "$template" ]]; then
    warn "systemd template not found, skipping service installation"
    return
  fi

  sed \
    -e "s|{{USER}}|$(whoami)|g" \
    -e "s|{{GROUP}}|$(id -gn)|g" \
    -e "s|{{INSTALL_DIR}}|${INSTALL_DIR}|g" \
    -e "s|{{NODE_BIN}}|${node_bin}|g" \
    "$template" | sudo tee "$service_file" > /dev/null

  sudo systemctl daemon-reload
  sudo systemctl enable "${APP_NAME}"
  sudo systemctl start "${APP_NAME}"

  success "systemd service installed and started"
}

setup_service_launchd() {
  info "Installing launchd service..."

  local node_bin
  node_bin="$(command -v node)"

  local plist_dir="$HOME/Library/LaunchAgents"
  local plist_file="${plist_dir}/com.revideo.server.plist"
  local template="$INSTALL_DIR/scripts/launchd/com.revideo.server.plist"

  if [[ ! -f "$template" ]]; then
    warn "launchd template not found, skipping service installation"
    return
  fi

  mkdir -p "$plist_dir"

  sed \
    -e "s|{{INSTALL_DIR}}|${INSTALL_DIR}|g" \
    -e "s|{{NODE_BIN}}|${node_bin}|g" \
    -e "s|{{HOME}}|${HOME}|g" \
    "$template" > "$plist_file"

  # Unload old service if exists
  launchctl bootout "gui/$(id -u)" "$plist_file" 2>/dev/null || true

  launchctl bootstrap "gui/$(id -u)" "$plist_file"
  launchctl kickstart -k "gui/$(id -u)/com.revideo.server" 2>/dev/null || true

  success "launchd service installed and started"
}

setup_service() {
  if [[ "$OS" == "linux" ]] && has_cmd systemctl; then
    setup_service_systemd
  elif [[ "$OS" == "darwin" ]] && has_cmd launchctl; then
    setup_service_launchd
  else
    warn "No service manager found. Start manually: node ${INSTALL_DIR}/dist/server.js"
  fi
}

# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
health_check() {
  info "Waiting for server to start..."
  local url="http://localhost:${PORT}/api/health"

  for i in $(seq 1 30); do
    if curl -fsS "$url" &>/dev/null; then
      success "Server is running at ${CYAN}http://localhost:${PORT}${NC}"
      return
    fi
    sleep 1
  done

  warn "Server did not respond within 30 seconds."
  warn "Check logs:"
  if [[ "$OS" == "linux" ]] && has_cmd systemctl; then
    warn "  sudo journalctl -u ${APP_NAME} -n 50"
  elif [[ "$OS" == "darwin" ]]; then
    warn "  cat ${INSTALL_DIR}/data/server-error.log"
  fi
}

# ---------------------------------------------------------------------------
# Uninstall
# ---------------------------------------------------------------------------
do_uninstall() {
  info "Uninstalling ${APP_NAME}..."

  # Stop service
  if [[ "$OS" == "linux" ]] && has_cmd systemctl; then
    sudo systemctl stop "${APP_NAME}" 2>/dev/null || true
    sudo systemctl disable "${APP_NAME}" 2>/dev/null || true
    sudo rm -f "/etc/systemd/system/${APP_NAME}.service"
    sudo systemctl daemon-reload
  elif [[ "$OS" == "darwin" ]] && has_cmd launchctl; then
    local plist_file="$HOME/Library/LaunchAgents/com.revideo.server.plist"
    launchctl bootout "gui/$(id -u)" "$plist_file" 2>/dev/null || true
    rm -f "$plist_file"
  fi

  # Kill any running process on port
  local pids
  pids="$(lsof -tiTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
  fi

  if [[ -d "$INSTALL_DIR" ]]; then
    if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
      rm -rf "$INSTALL_DIR"
    else
      echo ""
      read -rp "Remove installation directory ${INSTALL_DIR}? [y/N] " confirm
      case "$confirm" in
        y|Y|yes) rm -rf "$INSTALL_DIR"; success "Removed ${INSTALL_DIR}" ;;
        *) info "Kept ${INSTALL_DIR}" ;;
      esac
    fi
  fi

  success "Uninstall complete"
  exit 0
}

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------
print_banner() {
  printf "\n"
  printf "${CYAN}${BOLD}  ╭──────────────────────────────────────────────╮${NC}\n"
  printf "${CYAN}${BOLD}  │           Revideo Server Installer           │${NC}\n"
  printf "${CYAN}${BOLD}  ╰──────────────────────────────────────────────╯${NC}\n"
  printf "\n"
  printf "  ${BOLD}Video rendering, translation & republishing service${NC}\n"
  printf "  ${BOLD}Installer${NC}\n"
  printf "\n"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  print_banner

  if [[ "$ACTION" == "uninstall" ]]; then
    do_uninstall
  fi

  # 1. Detect environment
  detect_os
  detect_arch
  info "Platform: ${OS}-${ARCH} (${DISTRO:-$(uname -s)})"

  # 2. Ensure prerequisites
  ensure_node
  ensure_yt_dlp
  ensure_ffmpeg

  # 3. Download and extract
  download_and_extract "$VERSION"

  # 4. Setup .env
  setup_env

  # 5. Check Chrome (non-blocking)
  check_chrome

  # 6. Install and start service
  setup_service

  # 7. Health check
  health_check

  # 8. Success
  printf "\n"
  success "${BOLD}Installation complete!${NC}"
  printf "\n"
  printf "  Dashboard:  ${CYAN}http://localhost:${PORT}${NC}\n"
  printf "  Health:     ${CYAN}http://localhost:${PORT}/api/health${NC}\n"
  printf "  Config:     ${INSTALL_DIR}/.env\n"
  printf "  Data:       ${INSTALL_DIR}/data/\n"
  printf "\n"

  if [[ "$OS" == "linux" ]]; then
    printf "  ${BOLD}Service commands:${NC}\n"
    printf "    sudo systemctl status ${APP_NAME}\n"
    printf "    sudo systemctl restart ${APP_NAME}\n"
    printf "    sudo journalctl -u ${APP_NAME} -f\n"
  elif [[ "$OS" == "darwin" ]]; then
    printf "  ${BOLD}Service commands:${NC}\n"
    printf "    launchctl kickstart -k gui/$(id -u)/com.revideo.server\n"
    printf "    tail -f ${INSTALL_DIR}/data/server.log\n"
  fi
  printf "\n"
}

main
