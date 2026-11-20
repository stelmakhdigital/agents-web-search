#!/usr/bin/env bash
#
# SearXNG local instance for agents-web-search (native, no docker).
#
# Installs SearXNG from the official git repository into a Python venv,
# generates a minimal settings.yml (JSON API enabled, limiter off,
# loopback bind) and runs it as a service-managed instance on
# 127.0.0.1:8080 — the core's SEARXNG_DEFAULT_ENDPOINT. Service manager is
# picked by OS: systemd user unit on Linux, LaunchAgent (launchd, starts at
# login) on macOS. Idempotent: re-running skips what is already in place and
# never breaks an installed instance.
#
# Usage:
#   install.sh [install|update]   default: install
#   install.sh uninstall          stop, disable, remove unit + files
#   install.sh status             unit state + health probe
#   install.sh doctor             full environment/instance check (PASS/FAIL/WARN)
#   install.sh linger             enable login-linger (start the unit at boot);
#                                 no-op on macOS (LaunchAgent already starts at login)
#
# The PyPI package named `searxng` is an unrelated MCP server — do not
# use it; the engine itself is only distributed via git (rolling release).
set -euo pipefail

MODE="${1:-install}"

# The instance lives under the pi agent dir (honors $PI_CODING_AGENT_DIR).
PI_AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
SEARXNG_HOME="$PI_AGENT_DIR/web-search/searxng"
VENV="$SEARXNG_HOME/venv"
SRC="$SEARXNG_HOME/src"
SETTINGS="$SEARXNG_HOME/settings.yml"
UNIT_NAME="searxng.service"
UNIT_FILE="$HOME/.config/systemd/user/$UNIT_NAME"
# macOS LaunchAgent (label/plist path shared with packages/pi/src/searxng-health.ts).
LAUNCHD_LABEL="com.agents-web-search.searxng"
PLIST_FILE="$HOME/Library/LaunchAgents/$LAUNCHD_LABEL.plist"
REPO_URL="https://github.com/searxng/searxng"
# Rolling release: pin the source revision so an install is reproducible and
# a future upstream commit cannot break the JSON API or the build. `update`
# re-clones at the latest master and refreshes this pin.
PINNED_REF="ac11e14c5edf995d4d2f066bfb885a614f52a978"
BIND_HOST="127.0.0.1"
BIND_PORT="8080"

log() { echo "searxng-install: $*"; }
fail() { echo "searxng-install: ERROR: $*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || fail "$1 is required but not found in PATH"; }

python_bin() {
  need python3
  "$VENV/bin/python"
}

systemd_available() {
  command -v systemctl >/dev/null 2>&1 && systemctl --user >/dev/null 2>&1
}

# Service backend by OS: launchd on macOS (always present), systemd user
# session on Linux, none elsewhere (manual-start instructions are printed).
service_backend() {
  case "$(uname -s)" in
    Darwin) echo launchd ;;
    *) if systemd_available; then echo systemd; else echo none; fi ;;
  esac
}

launchd_target() { echo "gui/$(id -u)"; }
launchd_job() { echo "gui/$(id -u)/$LAUNCHD_LABEL"; }

ensure_dirs() { mkdir -p "$SEARXNG_HOME" "$VENV"; }

ensure_venv() {
  if [ -x "$VENV/bin/python" ]; then
    log "venv already present: $VENV"
    return
  fi
  log "creating venv at $VENV"
  if python3 -m ensurepip --version >/dev/null 2>&1; then
    python3 -m venv "$VENV"
  elif python3 -m virtualenv --version >/dev/null 2>&1 || command -v virtualenv >/dev/null 2>&1; then
    log "python3-venv (ensurepip) is missing — using virtualenv"
    python3 -m virtualenv "$VENV" 2>/dev/null || virtualenv "$VENV"
  else
    log "python3-venv (ensurepip) is missing — bootstrapping pip into a pip-less venv (get-pip.py)"
    python3 -m venv --without-pip "$VENV"
    need curl
    curl -fsS https://bootstrap.pypa.io/get-pip.py -o "$SEARXNG_HOME/get-pip.py"
    "$VENV/bin/python" "$SEARXNG_HOME/get-pip.py" --quiet
  fi
  [ -x "$VENV/bin/pip" ] || fail "venv created but pip is unavailable in it"
}

ensure_source() {
  if [ -d "$SRC/.git" ]; then
    log "source already cloned: $SRC (use 'update' to pull)"
    return
  fi
  need git
  log "fetching $REPO_URL at the pinned revision ${PINNED_REF:0:12}"
  git init --quiet "$SRC"
  git -C "$SRC" remote add origin "$REPO_URL"
  git -C "$SRC" fetch --quiet --depth 1 origin "$PINNED_REF"
  git -C "$SRC" checkout --quiet --detach FETCH_HEAD
}

ensure_packages() {
  if "$VENV/bin/python" -c "import searx, waitress" >/dev/null 2>&1; then
    log "engine already installed in the venv (use 'update' to refresh)"
    return
  fi
  log "installing the engine into the venv; this can take a few minutes"
  # searxng's setup.py imports the package itself (searx/__init__.py pulls
  # msgspec), so the dependencies must be in place before the editable
  # install — the same order the project's own manage scripts use.
  "$VENV/bin/pip" install --upgrade pip --quiet
  "$VENV/bin/pip" install setuptools wheel --quiet
  "$VENV/bin/pip" install -r "$SRC/requirements.txt" --quiet
  "$VENV/bin/pip" install -e "$SRC" --no-build-isolation --quiet
  "$VENV/bin/pip" install waitress --quiet
}

ensure_settings() {
  if [ -f "$SETTINGS" ]; then
    log "settings already present: $SETTINGS (kept as is)"
    return
  fi
  local secret
  secret="$(head -c 32 /dev/urandom | base64 | tr -d '/+=\n')"
  log "writing $SETTINGS (JSON API on, limiter off, bind $BIND_HOST:$BIND_PORT)"
  cat > "$SETTINGS" <<EOF
# Generated by agents-web-search scripts/searxng/install.sh — safe to edit.
use_default_settings: true

general:
  instance_name: "SearXNG (local)"

search:
  formats:
    - html
    - json

server:
  port: $BIND_PORT
  bind_address: "$BIND_HOST"
  secret_key: "$secret"
  limiter: false
  public_instance: false

valkey:
  url: false
EOF
}

# The WSGI runner: the same `application` object uwsgi would serve, hosted
# by waitress (pure Python, no uwsgi/emperor needed for a personal instance).
RUNNER_SNIPPET="from searx.webapp import application; import waitress; waitress.serve(application, host='$BIND_HOST', port=$BIND_PORT)"

ensure_unit() {
  case "$(service_backend)" in
    launchd) ensure_launch_agent ;;
    systemd) ensure_systemd_unit ;;
    none)
      log "no service manager (systemd user session / launchd) available — skipping autostart; run the instance manually with:"
      log "  SEARXNG_SETTINGS_PATH='$SETTINGS' '$VENV/bin/python' -c \"$RUNNER_SNIPPET\""
      ;;
  esac
}

# macOS LaunchAgent: RunAtLoad starts the instance at login, KeepAlive
# restarts it on a crash. Label/plist path must match
# packages/pi/src/searxng-health.ts (SEARXNG_LAUNCHD_LABEL).
ensure_launch_agent() {
  log "writing $PLIST_FILE"
  mkdir -p "$(dirname "$PLIST_FILE")" "$SEARXNG_HOME/logs"
  cat > "$PLIST_FILE" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LAUNCHD_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$VENV/bin/python</string>
    <string>-c</string>
    <string>$RUNNER_SNIPPET</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>SEARXNG_SETTINGS_PATH</key><string>$SETTINGS</string>
  </dict>
  <key>WorkingDirectory</key><string>$SRC</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key><false/>
    <key>Crashed</key><true/>
  </dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$SEARXNG_HOME/logs/launchd.out.log</string>
  <key>StandardErrorPath</key><string>$SEARXNG_HOME/logs/launchd.err.log</string>
</dict>
</plist>
EOF
  launchctl bootout "$(launchd_job)" 2>/dev/null || true
  # bootout is async: an immediate bootstrap can fail with "Bootstrap failed:
  # 5: Input/output error" while the old job is still unloading — retry.
  local i
  for i in 1 2 3 4 5; do
    launchctl bootstrap "$(launchd_target)" "$PLIST_FILE" 2>/dev/null && break
    sleep 1
  done
  launchctl print "$(launchd_job)" >/dev/null 2>&1 || fail "LaunchAgent не загрузился (launchctl print gui/$(id -u)/$LAUNCHD_LABEL)"
  log "LaunchAgent loaded (login-start via RunAtLoad): launchctl print $(launchd_job)"
}

ensure_systemd_unit() {
  log "writing $UNIT_FILE"
  mkdir -p "$(dirname "$UNIT_FILE")"
  cat > "$UNIT_FILE" <<EOF
[Unit]
Description=SearXNG local instance (agents-web-search)
After=network.target

[Service]
Type=simple
Environment=SEARXNG_SETTINGS_PATH=$SETTINGS
WorkingDirectory=$SRC
ExecStart=$VENV/bin/python -c "$RUNNER_SNIPPET"
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now "$UNIT_NAME"
  log "unit enabled and started: systemctl --user status $UNIT_NAME"
}

service_restart() {
  case "$(service_backend)" in
    launchd)
      launchctl kickstart -k "$(launchd_job)" 2>/dev/null && log "service restarted"
      ;;
    systemd)
      if systemctl --user is-active --quiet "$UNIT_NAME" 2>/dev/null; then
        systemctl --user restart "$UNIT_NAME" && log "unit restarted"
      fi
      ;;
    none) return 0 ;;
  esac
  return 0
}

do_install() {
  need python3
  local pyver
  pyver="$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
  { python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' || fail "python >= 3.9 required, got $pyver"; }
  ensure_dirs
  ensure_venv
  ensure_source
  ensure_packages
  ensure_settings
  ensure_unit
  log "done. Check: curl 'http://$BIND_HOST:$BIND_PORT/healthz' (expects: OK)"
  log "       JSON API: curl 'http://$BIND_HOST:$BIND_PORT/search?q=test&format=json'"
}

do_update() {
  [ -d "$SRC/.git" ] || fail "not installed yet — run without arguments first"
  need git
  log "resolving the latest master"
  local new_ref
  new_ref="$(git ls-remote origin refs/heads/master | cut -f1)"
  [ -n "$new_ref" ] || fail "could not resolve master via git ls-remote"
  local current_ref
  current_ref="$(git -C "$SRC" rev-parse HEAD)"
  if [ "$new_ref" = "$current_ref" ]; then
    log "already at the latest revision (${current_ref:0:12})"
  else
    log "moving to the latest revision (${new_ref:0:12})"
    git -C "$SRC" fetch --quiet --depth 1 origin "$new_ref"
    git -C "$SRC" checkout --quiet --detach FETCH_HEAD
    ensure_packages
  fi
  service_restart
}

do_uninstall() {
  if [ "$(service_backend)" = launchd ]; then
    launchctl bootout "$(launchd_job)" 2>/dev/null || true
    rm -f "$PLIST_FILE"
    log "LaunchAgent removed"
  elif systemd_available && [ -f "$UNIT_FILE" ]; then
    systemctl --user disable --now "$UNIT_NAME" 2>/dev/null || true
    rm -f "$UNIT_FILE"
    systemctl --user daemon-reload
    log "unit removed"
  else
    log "no unit to remove"
  fi
  if [ -d "$SEARXNG_HOME" ]; then
    rm -rf "$SEARXNG_HOME"
    log "instance files removed: $SEARXNG_HOME"
  fi
  log "uninstalled. The search falls back to ddg+bing automatically."
}

do_status() {
  echo "instance home: $SEARXNG_HOME"
  case "$(service_backend)" in
    launchd)
      if launchctl print "$(launchd_job)" >/dev/null 2>&1; then
        echo "LaunchAgent: loaded ($(launchd_job)); starts at login (RunAtLoad)"
      else
        echo "LaunchAgent: not loaded (run install)"
      fi
      ;;
    systemd)
      echo "unit: $(systemctl --user is-active "$UNIT_NAME" 2>/dev/null; true)"
      if loginctl show-user "$USER" -p Linger 2>/dev/null | grep -q '=yes'; then
        echo "linger: on (the unit starts at boot)"
      else
        echo "linger: off — the unit will NOT start after a reboot until you log in with a systemd session"
        echo "        (enable with: $0 linger)"
      fi
      ;;
    none)
      echo "unit: no service manager available"
      ;;
  esac
  echo -n "health (http://$BIND_HOST:$BIND_PORT/healthz): "
  if curl -fsS -o /dev/null -m 2 "http://$BIND_HOST:$BIND_PORT/healthz" 2>/dev/null; then
    echo "OK"
  else
    echo "unreachable"
  fi
  echo -n "JSON API: "
  if curl -fsS -o /dev/null -m 2 "http://$BIND_HOST:$BIND_PORT/search?q=ping&format=json" 2>/dev/null; then
    echo "OK"
  else
    echo "unreachable"
  fi
}

do_linger() {
  if [ "$(service_backend)" = launchd ]; then
    log "not applicable on macOS: the LaunchAgent starts the instance at every login (RunAtLoad)"
    return
  fi
  need loginctl
  if loginctl show-user "$USER" -p Linger 2>/dev/null | grep -q '=yes'; then
    log "linger is already on"
  else
    loginctl enable-linger "$USER"
    log "linger enabled: the searxng user unit now starts at boot without a login"
  fi
}

do_doctor() {
  local failures=0
  check() {
    local label="$1"; shift
    if "$@" >/dev/null 2>&1; then
      echo "PASS  $label"
    else
      echo "FAIL  $label"
      failures=$((failures + 1))
    fi
  }
  check 'python >= 3.9' bash -c 'command -v python3 >/dev/null && python3 -c "import sys; sys.exit(0 if sys.version_info >= (3,9) else 1)"'
  check 'git' git --version
  check 'curl' curl --version
  case "$(service_backend)" in
    launchd)
      if launchctl print "$(launchd_job)" >/dev/null 2>&1; then
        echo "PASS  LaunchAgent loaded (starts at login)"
      else
        echo 'WARN  LaunchAgent not loaded — run install.sh install'
      fi
      ;;
    systemd)
      check "unit $UNIT_NAME active" systemctl --user is-active --quiet "$UNIT_NAME"
      if loginctl show-user "$USER" -p Linger 2>/dev/null | grep -q '=yes'; then
        echo 'PASS  linger (starts at boot)'
      else
        echo 'WARN  linger off — the unit will not start after a reboot without a login (enable: ./install.sh linger)'
      fi
      ;;
    none)
      echo 'WARN  no service manager available — the unit cannot be managed; start the instance manually'
      ;;
  esac
  check "engine importable (venv)" "$VENV/bin/python" -c 'import searx, waitress'
  check 'health endpoint' curl -fsS -o /dev/null -m 3 "http://$BIND_HOST:$BIND_PORT/healthz"
  check 'JSON API responds' curl -fsS -o /dev/null -m 5 "http://$BIND_HOST:$BIND_PORT/search?q=ping&format=json"
  if grep -q 'format=json\|- json' "$SETTINGS" 2>/dev/null; then
    echo 'PASS  settings.yml has the JSON format enabled'
  elif [ -f "$SETTINGS" ]; then
    echo 'WARN  settings.yml exists but the JSON format is not declared (JSON API will 403)'
  else
    echo 'FAIL  settings.yml missing'
    failures=$((failures + 1))
  fi
  if [ "$failures" -gt 0 ]; then
    fail "$failures check(s) failed — see the FAIL lines above"
  fi
  log 'all checks passed'
}

case "$MODE" in
  install) do_install ;;
  update)  do_update ;;
  uninstall) do_uninstall ;;
  status)  do_status ;;
  doctor)  do_doctor ;;
  linger)  do_linger ;;
  *) fail "unknown mode '$MODE' (use: install | update | uninstall | status | doctor | linger)" ;;
esac
