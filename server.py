#!/usr/bin/env python3
"""
GRZYBKOWO CYBER-OPS // MINECRAFT DASHBOARD BACKEND
Ultra-lightweight, zero-dependency Python 3 standard library server.
Runs on 192.168.1.15 (Ubuntu host 'Grzybkowo') on port 8080.
"""

import base64
import hmac
import http.server
import json
import os
import re
import shutil
import socket
import struct
import subprocess
import sys
import threading
import tempfile
import time
import zipfile
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from terrain import terrain_grid

CONFIG_PATH = Path(__file__).resolve().parent / "config.json"
DEFAULT_CONFIG = {
    "mc_dir": "/opt/minecraft",
    "sudo_pass": "",
    "port": 8080,
    "auth_user": "admin",
    "auth_password": "",
    "mom_user": "mama",
    "mom_password": ""
}

_cfg = dict(DEFAULT_CONFIG)
if CONFIG_PATH.exists():
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as _f:
            _cfg.update(json.load(_f))
    except Exception as _e:
        print(f"[WARN] Failed to load config.json: {_e}", file=sys.stderr)

MC_DIR = Path(os.environ.get("MC_DIR", _cfg["mc_dir"]))
SUDO_PASS = os.environ.get("SUDO_PASS", _cfg["sudo_pass"])
PORT = int(os.environ.get("PORT", _cfg["port"]))
AUTH_USER = os.environ.get("DASHBOARD_USER", _cfg["auth_user"])
AUTH_PASSWORD = os.environ.get("DASHBOARD_PASSWORD", _cfg["auth_password"])
MOM_USER = os.environ.get("MOM_USER", _cfg["mom_user"])
MOM_PASSWORD = os.environ.get("MOM_PASSWORD", _cfg["mom_password"])
WEB_DIR = Path(__file__).resolve().parent / "web"
MAX_MOD_BYTES = 256 * 1024 * 1024
MOD_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._+() -]{0,179}\.jar$", re.IGNORECASE)
RESOURCE_ID_RE = re.compile(r"^[a-z0-9_.-]+:[a-z0-9_./-]+$")
PLAYER_RE = re.compile(r"^[A-Za-z0-9_]{1,16}$")
upload_lock = threading.Lock()
terrain_lock = threading.Lock()


def valid_mod_name(name):
    return bool(MOD_NAME_RE.fullmatch(name)) and Path(name).name == name


def valid_mod_jar(path):
    try:
        with zipfile.ZipFile(path) as archive:
            names = set(archive.namelist())
        return bool(names & {"META-INF/mods.toml", "fabric.mod.json", "quilt.mod.json"})
    except (OSError, zipfile.BadZipFile):
        return False


def valid_basic_auth(header, expected_user, expected_password):
    try:
        scheme, token = header.split(" ", 1)
        supplied = base64.b64decode(token, validate=True).decode("utf-8")
        user, password = supplied.split(":", 1)
    except (ValueError, UnicodeDecodeError):
        return False
    return (
        scheme.lower() == "basic"
        and hmac.compare_digest(user, expected_user)
        and hmac.compare_digest(password, expected_password)
    )


def is_mom_route(path):
    return path in ("/mama", "/mama/") or path.startswith("/api/mama/")


def valid_route_auth(header, path, admin_user, admin_password, mom_user, mom_password):
    admin = valid_basic_auth(header, admin_user, admin_password)
    if not is_mom_route(path):
        return admin
    return admin or bool(mom_password) and valid_basic_auth(header, mom_user, mom_password)


def parse_entity_position(response):
    match = re.search(
        r"\[\s*(-?\d+(?:\.\d+)?)[dDfF]?,\s*(-?\d+(?:\.\d+)?)[dDfF]?,\s*(-?\d+(?:\.\d+)?)[dDfF]?\s*\]",
        response,
    )
    return [round(float(value), 1) for value in match.groups()] if match else None


def parse_entity_positions(response):
    return [
        [round(float(value), 1) for value in match.groups()]
        for match in re.finditer(
            r"\[\s*(-?\d+(?:\.\d+)?)[dDfF]?,\s*(-?\d+(?:\.\d+)?)[dDfF]?,\s*(-?\d+(?:\.\d+)?)[dDfF]?\s*\]",
            response,
        )
    ]


def parse_named_entity_positions(response):
    pattern = re.compile(
        r"(?m)^(.+?) has the following entity data: \[\s*(-?\d+(?:\.\d+)?)[dDfF]?,\s*(-?\d+(?:\.\d+)?)[dDfF]?,\s*(-?\d+(?:\.\d+)?)[dDfF]?\s*\]"
    )
    return [
        {"name": match.group(1).strip(), "x": round(float(match.group(2)), 1), "y": round(float(match.group(3)), 1), "z": round(float(match.group(4)), 1)}
        for match in pattern.finditer(response)
    ]


def build_summon_command(entity_id, dimension, x, z, y=None):
    if y is None:
        return f'execute in {dimension} positioned {x} 0 {z} positioned over motion_blocking_no_leaves run summon {entity_id} ~ ~1 ~ {{Tags:["cyberops_tracked"]}}'
    return f'execute in {dimension} run summon {entity_id} {x} {y} {z} {{Tags:["cyberops_tracked"]}}'


def tactical_players(names):
    players = []
    for name in names:
        if not PLAYER_RE.fullmatch(name):
            continue
        position = parse_entity_position(rcon_command(f"data get entity {name} Pos", timeout=1.5))
        dimension_response = rcon_command(f"data get entity {name} Dimension", timeout=1.5)
        dimension_match = re.search(r"([a-z0-9_.-]+:[a-z0-9_./-]+)", dimension_response)
        if position:
            players.append({
                "name": name,
                "x": position[0],
                "y": position[1],
                "z": position[2],
                "dimension": dimension_match.group(1) if dimension_match else "minecraft:overworld",
            })
    return players


def tactical_mobs(dimension):
    response = rcon_command(
        f"execute in {dimension} as @e[tag=cyberops_tracked] run data get entity @s Pos",
        timeout=2.0,
    )
    mobs = parse_named_entity_positions(response)
    for index, mob in enumerate(mobs, 1):
        mob.update({"id": index, "dimension": dimension})
    return mobs

# Cache for telemetry to ensure lightning-fast responses
telemetry_lock = threading.Lock()
telemetry_data = {
    "system": {},
    "minecraft": {},
    "timestamp": 0
}

# Chat tracking & parser
admin_chat_messages = []
admin_chat_lock = threading.Lock()

CHAT_RE = re.compile(r'^\[(?:\d{2}\w{3}\d{4}\s+)?(\d{2}:\d{2}:\d{2})(?:\.\d+)?\]\s+\[.*?\]\s+\[.*?\]:\s+(?:\[Not Secure\]\s*)?<([a-zA-Z0-9_]{1,16})>\s*(.*)$')
EVENT_RE = re.compile(r'^\[(?:\d{2}\w{3}\d{4}\s+)?(\d{2}:\d{2}:\d{2})(?:\.\d+)?\]\s+\[.*?\]\s+\[.*?\]:\s+([a-zA-Z0-9_]{1,16})\s+(joined the game|left the game|lost connection.*)$')

def get_chat_feed(limit=80):
    messages = []
    log_path = MC_DIR / "logs" / "latest.log"
    if log_path.exists():
        try:
            with open(log_path, "r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()[-5000:]
                for idx, line in enumerate(lines):
                    line_str = line.strip()
                    m = CHAT_RE.match(line_str)
                    if m:
                        t_str = m.group(1)
                        s_str = m.group(2)
                        msg_str = m.group(3)
                        messages.append({
                            "id": f"p_{t_str}_{s_str}_{hash(msg_str)}",
                            "time": t_str,
                            "type": "player",
                            "sender": s_str,
                            "text": msg_str
                        })
                        continue
                    m_ev = EVENT_RE.match(line_str)
                    if m_ev:
                        t_str = m_ev.group(1)
                        s_str = m_ev.group(2)
                        ev_str = m_ev.group(3)
                        messages.append({
                            "id": f"ev_{t_str}_{s_str}_{hash(ev_str)}",
                            "time": t_str,
                            "type": "event",
                            "sender": s_str,
                            "text": ev_str
                        })
        except Exception:
            pass

    with admin_chat_lock:
        for a_msg in admin_chat_messages:
            messages.append(a_msg)

    # Sort stably by time
    messages.sort(key=lambda x: x.get("time", "00:00:00"))
    return messages[-limit:]

def parse_server_properties():
    props_path = MC_DIR / "server.properties"
    props = {}
    if props_path.exists():
        try:
            with open(props_path, "r", encoding="utf-8", errors="replace") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        props[k.strip()] = v.strip()
        except Exception:
            pass
    return props

def rcon_command(cmd, timeout=3.0):
    props = parse_server_properties()
    host = "127.0.0.1"
    port = int(props.get("rcon.port", 25575))
    password = props.get("rcon.password", "")
    
    if not password:
        return "RCON password not configured in server.properties"
    
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        sock.connect((host, port))
        
        # Type 3: SERVERDATA_AUTH
        auth_pkg = struct.pack('<iii', 10 + len(password), 1, 3) + password.encode('utf-8') + b'\x00\x00'
        sock.sendall(auth_pkg)
        resp = sock.recv(4096)
        if len(resp) < 12:
            sock.close()
            return "Invalid RCON response"
        
        length, req_id, p_type = struct.unpack('<iii', resp[:12])
        if req_id == -1:
            sock.close()
            return "RCON Auth Failed"
        
        # Type 2: SERVERDATA_EXECCOMMAND
        cmd_pkg = struct.pack('<iii', 10 + len(cmd), 2, 2) + cmd.encode('utf-8') + b'\x00\x00'
        sock.sendall(cmd_pkg)
        resp = sock.recv(8192)
        sock.close()
        
        if len(resp) >= 12:
            body = resp[12:-2].decode('utf-8', errors='replace').strip()
            # Strip ANSI Minecraft color codes if any
            clean_body = re.sub(r'§[0-9a-fk-or]', '', body)
            return clean_body or "(Brak odpowiedzi / Wykonano)"
        return "(Brak odpowiedzi)"
    except Exception as e:
        return f"Błąd RCON: {str(e)}"

# Differential CPU tracking
prev_cpu_total = 0
prev_cpu_idle = 0

def get_cpu_percent():
    global prev_cpu_total, prev_cpu_idle
    try:
        with open("/proc/stat", "r") as f:
            first_line = f.readline()
        parts = [float(x) for x in first_line.split()[1:8]]
        # user, nice, system, idle, iowait, irq, softirq
        idle = parts[3] + parts[4]
        total = sum(parts)
        
        delta_total = total - prev_cpu_total
        delta_idle = idle - prev_cpu_idle
        
        prev_cpu_total = total
        prev_cpu_idle = idle
        
        if delta_total > 0:
            usage = 100.0 * (1.0 - (delta_idle / delta_total))
            return max(0.0, min(100.0, round(usage, 1)))
    except Exception:
        pass
    return 0.0

def get_temperatures():
    result = {"package": None, "cores": [], "sensors_raw": ""}
    try:
        p = subprocess.run(["sensors", "-j"], capture_output=True, text=True, timeout=1.5)
        if p.returncode == 0:
            data = json.loads(p.stdout)
            # Find coretemp or similar
            for chip, chip_data in data.items():
                if "coretemp" in chip or "cpu" in chip:
                    for k, v in chip_data.items():
                        if isinstance(v, dict):
                            for prop, val in v.items():
                                if "input" in prop and isinstance(val, (int, float)):
                                    if "package" in k.lower():
                                        result["package"] = round(val, 1)
                                    elif "core" in k.lower():
                                        result["cores"].append({"name": k, "temp": round(val, 1)})
            if result["package"] is None and result["cores"]:
                result["package"] = result["cores"][0]["temp"]
    except Exception:
        pass
    
    # Fallback to thermal_zone if sensors fails
    if result["package"] is None:
        try:
            for zone in Path("/sys/class/thermal").glob("thermal_zone*"):
                temp_file = zone / "temp"
                type_file = zone / "type"
                if temp_file.exists():
                    raw_temp = int(temp_file.read_text().strip()) / 1000.0
                    ztype = type_file.read_text().strip() if type_file.exists() else "temp"
                    if result["package"] is None:
                        result["package"] = round(raw_temp, 1)
                    result["cores"].append({"name": ztype, "temp": round(raw_temp, 1)})
        except Exception:
            pass
            
    return result

def get_memory_info():
    mem = {}
    try:
        with open("/proc/meminfo", "r") as f:
            for line in f:
                parts = line.split(":")
                if len(parts) == 2:
                    k = parts[0].strip()
                    v = parts[1].strip().split()[0]
                    mem[k] = int(v) * 1024  # to bytes
        
        total = mem.get("MemTotal", 1)
        free = mem.get("MemFree", 0)
        avail = mem.get("MemAvailable", free)
        used = total - avail
        
        swap_total = mem.get("SwapTotal", 0)
        swap_free = mem.get("SwapFree", 0)
        swap_used = swap_total - swap_free
        
        return {
            "total_bytes": total,
            "used_bytes": used,
            "free_bytes": avail,
            "used_percent": round(100.0 * used / total, 1),
            "swap_total_bytes": swap_total,
            "swap_used_bytes": swap_used,
            "swap_percent": round(100.0 * swap_used / swap_total, 1) if swap_total > 0 else 0.0
        }
    except Exception:
        return {"total_bytes": 0, "used_bytes": 0, "free_bytes": 0, "used_percent": 0}

def get_disk_info():
    try:
        usage = shutil.disk_usage(str(MC_DIR))
        return {
            "total_bytes": usage.total,
            "used_bytes": usage.used,
            "free_bytes": usage.free,
            "used_percent": round(100.0 * usage.used / usage.total, 1)
        }
    except Exception:
        return {"total_bytes": 0, "used_bytes": 0, "free_bytes": 0, "used_percent": 0}

def get_minecraft_status():
    status = {
        "active": False,
        "state": "unknown",
        "sub_state": "unknown",
        "pid": None,
        "jvm_memory_mb": 0,
        "jvm_cpu_percent": 0.0,
        "players": {"count": 0, "max": 8, "list": []},
        "uptime": "offline"
    }
    
    # Check systemd status
    try:
        p = subprocess.run(
            ["systemctl", "show", "minecraft.service", "--property=ActiveState,SubState,ExecMainPID,ActiveEnterTimestamp"],
            capture_output=True, text=True, timeout=2.0
        )
        if p.returncode == 0:
            lines = p.stdout.strip().splitlines()
            props = {}
            for line in lines:
                if "=" in line:
                    k, v = line.split("=", 1)
                    props[k.strip()] = v.strip()
            
            status["state"] = props.get("ActiveState", "unknown")
            status["sub_state"] = props.get("SubState", "unknown")
            status["active"] = (status["state"] == "active")
            pid_str = props.get("ExecMainPID", "0")
            if pid_str and pid_str != "0":
                status["pid"] = int(pid_str)
            status["uptime"] = props.get("ActiveEnterTimestamp", "")
    except Exception:
        pass

    # Find actual java pid for Forge
    java_pid = None
    try:
        for p_dir in Path("/proc").glob("[0-9]*"):
            try:
                cmdline = (p_dir / "cmdline").read_bytes().replace(b'\x00', b' ').decode('utf-8', errors='ignore')
                if "minecraftforge" in cmdline or "user_jvm_args.txt" in cmdline or ("/opt/minecraft" in cmdline and "java" in cmdline):
                    java_pid = int(p_dir.name)
                    break
            except Exception:
                continue
    except Exception:
        pass

    if java_pid:
        status["java_pid"] = java_pid
        # Memory RSS
        try:
            with open(f"/proc/{java_pid}/status", "r") as f:
                for line in f:
                    if line.startswith("VmRSS:"):
                        rss_kb = int(line.split()[1])
                        status["jvm_memory_mb"] = round(rss_kb / 1024.0, 1)
                        break
        except Exception:
            pass

    # Query online players via RCON
    if status["active"]:
        rcon_resp = rcon_command("list", timeout=1.0)
        # Typical output: "There are 1 of a max of 8 players online: grzybeksigma67"
        match = re.search(r'There are (\d+) of a max of (\d+) players online:?\s*(.*)', rcon_resp)
        if match:
            cnt = int(match.group(1))
            m = int(match.group(2))
            names_raw = match.group(3).strip()
            player_list = [n.strip() for n in names_raw.split(',') if n.strip()] if names_raw else []
            status["players"] = {
                "count": cnt,
                "max": m,
                "list": player_list
            }

    return status

def run_sudo_cmd(args):
    """Executes a command with sudo, feeding password via stdin."""
    full_cmd = ["sudo", "-S"] + args
    p = subprocess.run(
        full_cmd,
        input=(SUDO_PASS + "\n").encode("utf-8"),
        capture_output=True,
        timeout=20.0
    )
    stdout = p.stdout.decode("utf-8", errors="replace")
    stderr = p.stderr.decode("utf-8", errors="replace")
    # Strip password prompt
    stderr_clean = re.sub(r'\[sudo\] password for .*?:\s*', '', stderr).strip()
    return p.returncode, stdout.strip(), stderr_clean

def telemetry_poller():
    """Background thread polling telemetry every 1.5 seconds"""
    while True:
        try:
            cpu = get_cpu_percent()
            temp = get_temperatures()
            mem = get_memory_info()
            disk = get_disk_info()
            mc = get_minecraft_status()
            
            # Load averages
            load_1, load_5, load_15 = os.getloadavg()
            
            # System uptime
            uptime_str = ""
            try:
                with open("/proc/uptime", "r") as f:
                    sec = float(f.readline().split()[0])
                    days = int(sec // 86400)
                    hours = int((sec % 86400) // 3600)
                    mins = int((sec % 3600) // 60)
                    uptime_str = f"{days}d {hours}h {mins}m"
            except Exception:
                pass

            with telemetry_lock:
                telemetry_data["system"] = {
                    "hostname": "Grzybkowo",
                    "cpu_percent": cpu,
                    "temp": temp,
                    "memory": mem,
                    "disk": disk,
                    "load_avg": [round(load_1, 2), round(load_5, 2), round(load_15, 2)],
                    "uptime": uptime_str
                }
                telemetry_data["minecraft"] = mc
                telemetry_data["timestamp"] = time.time()
        except Exception as e:
            print(f"[Telemetry Worker Error] {e}", file=sys.stderr)
        time.sleep(1.5)

class CyberHandler(http.server.BaseHTTPRequestHandler):
    def is_authorized(self):
        path = urlparse(self.path).path
        if valid_route_auth(self.headers.get("Authorization", ""), path, AUTH_USER, AUTH_PASSWORD, MOM_USER, MOM_PASSWORD):
            return True
        self.send_response(401)
        realm = "Panel Mamy" if is_mom_route(path) else "Minecraft Cyber-Ops"
        self.send_header("WWW-Authenticate", f'Basic realm="{realm}", charset="UTF-8"')
        self.send_header("Content-Length", "0")
        self.end_headers()
        return False

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, msg, status=400):
        self.send_json({"error": msg, "success": False}, status=status)

    def do_OPTIONS(self):
        if not self.is_authorized():
            return
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        if not self.is_authorized():
            return
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path in ("/mama", "/mama/"):
            self.serve_file(WEB_DIR / "mama.html", "text/html; charset=utf-8")
            return

        if path == "/api/mama/state":
            with telemetry_lock:
                players = dict(telemetry_data.get("minecraft", {}).get("players", {"count": 0, "max": 8, "list": []}))
            self.send_json({"players": players, "messages": get_chat_feed(40)})
            return

        if path == "/api/status":
            with telemetry_lock:
                self.send_json(telemetry_data)
            return

        elif path == "/api/logs":
            lines_cnt = int(query.get("lines", [120])[0])
            log_path = MC_DIR / "logs" / "latest.log"
            if not log_path.exists():
                self.send_json({"lines": ["Log file not found."]})
                return
            try:
                with open(log_path, "r", encoding="utf-8", errors="replace") as f:
                    all_lines = f.readlines()
                    tail = all_lines[-lines_cnt:]
                    self.send_json({"lines": tail, "total_lines": len(all_lines)})
            except Exception as e:
                self.send_error_json(f"Error reading log: {str(e)}")
            return

        elif path == "/api/files":
            rel_path = query.get("path", ["."])[0].strip().lstrip("/")
            target_dir = (MC_DIR / rel_path).resolve()
            
            # Security check: must remain inside MC_DIR
            try:
                target_dir.relative_to(MC_DIR.resolve())
            except ValueError:
                self.send_error_json("Access denied: path outside /opt/minecraft", 403)
                return

            if not target_dir.exists() or not target_dir.is_dir():
                self.send_error_json("Directory does not exist", 404)
                return

            items = []
            try:
                for entry in sorted(target_dir.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
                    stat = entry.stat()
                    is_dir = entry.is_dir()
                    is_text = entry.suffix.lower() in [
                        ".txt", ".json", ".properties", ".log", ".toml", ".yml", ".yaml", ".cfg", ".sh", ".bat", ".md"
                    ]
                    items.append({
                        "name": entry.name,
                        "rel_path": str(entry.relative_to(MC_DIR.resolve())).replace("\\", "/"),
                        "is_dir": is_dir,
                        "size": stat.st_size if not is_dir else None,
                        "mtime": int(stat.st_mtime),
                        "is_text": is_text,
                        "is_jar": entry.suffix.lower() == ".jar",
                        "is_disabled_jar": entry.name.endswith(".jar.disabled")
                    })
                self.send_json({
                    "current_path": str(target_dir.relative_to(MC_DIR.resolve())).replace("\\", "/"),
                    "items": items
                })
            except Exception as e:
                self.send_error_json(f"Error reading directory: {str(e)}")
            return

        elif path == "/api/file/read":
            rel_path = query.get("path", [""])[0].strip().lstrip("/")
            target_file = (MC_DIR / rel_path).resolve()

            try:
                target_file.relative_to(MC_DIR.resolve())
            except ValueError:
                self.send_error_json("Access denied: path outside /opt/minecraft", 403)
                return

            if not target_file.exists() or target_file.is_dir():
                self.send_error_json("File does not exist or is directory", 404)
                return

            # Max 2MB read limit
            if target_file.stat().st_size > 2 * 1024 * 1024:
                self.send_error_json("File too large to display directly (max 2MB)")
                return

            try:
                with open(target_file, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()
                self.send_json({
                    "path": str(target_file.relative_to(MC_DIR.resolve())).replace("\\", "/"),
                    "content": content,
                    "size": len(content)
                })
            except Exception as e:
                self.send_error_json(f"Error reading file: {str(e)}")
            return

        elif path == "/api/mods":
            mods_dir = MC_DIR / "mods"
            items = []
            if mods_dir.exists():
                for f in sorted(mods_dir.glob("*")):
                    if f.name.startswith("."):
                        continue
                    stat = f.stat()
                    is_disabled = f.name.endswith(".disabled")
                    items.append({
                        "name": f.name,
                        "rel_path": str(f.relative_to(MC_DIR.resolve())).replace("\\", "/"),
                        "size": stat.st_size,
                        "mtime": int(stat.st_mtime),
                        "enabled": not is_disabled,
                        "is_jar": f.suffix.lower() == ".jar" or is_disabled
                    })
            self.send_json({"mods": items})
            return

        elif path == "/api/chat":
            limit = int(query.get("limit", [80])[0])
            self.send_json({"messages": get_chat_feed(limit)})
            return

        elif path == "/api/tactical":
            dimension = query.get("dimension", ["minecraft:overworld"])[0].lower()
            if not RESOURCE_ID_RE.fullmatch(dimension):
                self.send_error_json("Invalid dimension ID")
                return
            with telemetry_lock:
                names = list(telemetry_data.get("minecraft", {}).get("players", {}).get("list", []))
            self.send_json({"players": tactical_players(names), "mobs": tactical_mobs(dimension)})
            return

        elif path == "/api/terrain":
            dimension = query.get("dimension", ["minecraft:overworld"])[0].lower()
            try:
                center_x = int(query.get("x", [0])[0])
                center_z = int(query.get("z", [0])[0])
                span = max(64, min(32768, int(query.get("span", [512])[0])))
            except ValueError:
                self.send_error_json("Invalid terrain coordinates")
                return
            if not RESOURCE_ID_RE.fullmatch(dimension) or abs(center_x) > 30000000 or abs(center_z) > 30000000:
                self.send_error_json("Invalid terrain location")
                return
            world_dir = MC_DIR / parse_server_properties().get("level-name", "world")
            with terrain_lock:
                terrain = terrain_grid(world_dir, dimension, center_x, center_z, span)
            self.send_json(terrain)
            return

        # Serve static web frontend
        if path == "/" or path == "/index.html":
            self.serve_file(WEB_DIR / "index.html", "text/html; charset=utf-8")
        elif path == "/style.css":
            self.serve_file(WEB_DIR / "style.css", "text/css; charset=utf-8")
        elif path == "/app.js":
            self.serve_file(WEB_DIR / "app.js", "application/javascript; charset=utf-8")
        else:
            file_path = (WEB_DIR / path.lstrip("/")).resolve()
            if file_path.exists() and file_path.is_file():
                self.serve_file(file_path, "application/octet-stream")
            else:
                self.send_response(404)
                self.end_headers()
                self.wfile.write(b"404 Not Found")

    def serve_file(self, path, content_type):
        try:
            with open(path, "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            self.send_error_json(str(e), 500)

    def do_POST(self):
        if not self.is_authorized():
            return
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/mod/upload":
            self.upload_mod(parse_qs(parsed.query))
            return
        
        # Read JSON body
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8") if content_length > 0 else "{}"
        try:
            data = json.loads(body)
        except Exception:
            data = {}

        if path == "/api/mama/send":
            text = str(data.get("text", "")).strip()
            target = str(data.get("target", "@a")).strip()
            mode = str(data.get("mode", "chat")).strip()
            if not text or len(text) > 240:
                self.send_error_json("Wiadomość musi mieć od 1 do 240 znaków.")
                return
            if target != "@a" and not PLAYER_RE.fullmatch(target):
                self.send_error_json("Nieprawidłowy odbiorca.")
                return
            if mode not in ("chat", "title", "actionbar"):
                self.send_error_json("Nieprawidłowy tryb wiadomości.")
                return
            message = json.dumps(f"[Mama] {text}", ensure_ascii=False)
            if mode == "title":
                command = f'title {target} title {{"text":{message},"color":"light_purple","bold":true}}'
            elif mode == "actionbar":
                command = f'title {target} actionbar {{"text":{message},"color":"light_purple","bold":true}}'
            else:
                command = f'tellraw {target} {{"text":{message},"color":"light_purple","bold":true}}'
            response = rcon_command(command)
            failed = any(word in response.lower() for word in ("error", "failed", "incorrect", "unknown", "błąd rcon", "not configured", "no player"))
            if failed:
                self.send_error_json(response, 502)
                return
            with admin_chat_lock:
                admin_chat_messages.append({
                    "id": f"mom_{time.time()}", "time": time.strftime("%H:%M:%S"), "type": "admin",
                    "sender": "Mama", "text": text, "mode": mode, "target": target
                })
                if len(admin_chat_messages) > 120:
                    admin_chat_messages.pop(0)
            self.send_json({"success": True, "message": "Wiadomość wysłana jako Mama."})
            return

        if path == "/api/server/control":
            action = data.get("action", "")
            if action not in ["start", "stop", "restart", "kill"]:
                self.send_error_json("Invalid action. Must be start, stop, restart, or kill.")
                return

            if action in ["start", "stop", "restart"]:
                code, stdout, stderr = run_sudo_cmd(["systemctl", action, "minecraft.service"])
                if code == 0:
                    self.send_json({"success": True, "message": f"Server {action} initiated successfully.", "output": stdout})
                else:
                    self.send_json({"success": False, "message": f"Failed to {action} server.", "error": stderr}, 500)
            elif action == "kill":
                # Emergency kill
                code, stdout, stderr = run_sudo_cmd(["pkill", "-9", "-f", "forge"])
                self.send_json({"success": True, "message": "Emergency SIGKILL dispatched to Forge processes."})
            return

        elif path == "/api/tactical/spawn":
            entity_id = str(data.get("entity", "")).lower()
            dimension = str(data.get("dimension", "minecraft:overworld")).lower()
            try:
                x = int(data.get("x"))
                z = int(data.get("z"))
                y = None if data.get("y") in (None, "") else int(data.get("y"))
                count = int(data.get("count", 1))
            except (TypeError, ValueError):
                self.send_error_json("Coordinates and count must be whole numbers")
                return
            if not RESOURCE_ID_RE.fullmatch(entity_id) or not RESOURCE_ID_RE.fullmatch(dimension):
                self.send_error_json("Invalid entity or dimension ID")
                return
            if abs(x) > 30000000 or abs(z) > 30000000 or (y is not None and not -2048 <= y <= 2048):
                self.send_error_json("Coordinates are outside the allowed world range")
                return
            if not 1 <= count <= 10:
                self.send_error_json("Count must be between 1 and 10")
                return

            command = build_summon_command(entity_id, dimension, x, z, y)
            responses = [rcon_command(command) for _ in range(count)]
            failed = any(any(word in response.lower() for word in ("error", "failed", "unable", "incorrect", "unknown", "cannot", "błąd rcon", "not configured")) for response in responses)
            self.send_json({"success": not failed, "command": command, "responses": responses}, 500 if failed else 200)
            return

        elif path == "/api/rcon":
            cmd = data.get("command", "").strip()
            if not cmd:
                self.send_error_json("Empty command.")
                return
            # Remove leading slash if user typed /say or /help
            if cmd.startswith("/"):
                cmd = cmd[1:]

            known_cmds = (
                "list", "help", "time", "weather", "gamemode", "tp", "teleport",
                "op", "deop", "kick", "ban", "pardon", "whitelist", "give",
                "kill", "difficulty", "save-all", "save-off", "save-on", "stop",
                "seed", "locate", "scoreboard", "datapack", "effect", "enchant",
                "clear", "xp", "experience", "gamerule", "tellraw", "title",
                "playsound", "stopsound", "defaultgamemode", "worldborder",
                "summon", "setblock", "fill", "clone", "tag", "team"
            )

            first_word = cmd.split()[0].lower() if cmd else ""
            is_admin_chat = False
            msg_text = ""

            if cmd.lower().startswith("say "):
                is_admin_chat = True
                msg_text = cmd[4:].strip()
            elif cmd.lower().startswith("admin "):
                is_admin_chat = True
                msg_text = cmd[6:].strip()
            elif first_word not in known_cmds:
                # Direct message from admin console
                is_admin_chat = True
                msg_text = cmd

            if is_admin_chat:
                escaped_msg = json.dumps(msg_text)
                tellraw_cmd = f'tellraw @a [{{"text":"[Admin] ","color":"red","bold":true}},{{"text":{escaped_msg},"color":"yellow"}}]'
                resp = rcon_command(tellraw_cmd)
                resp_display = f'Wysłano do graczy jako [Admin]: "{msg_text}"'
                self.send_json({"command": tellraw_cmd, "response": resp_display, "success": True})
                return
            
            resp = rcon_command(cmd)
            self.send_json({"command": cmd, "response": resp, "success": True})
            return

        elif path == "/api/chat/send":
            text = data.get("text", "").strip()
            mode = data.get("mode", "chat").strip()
            target = data.get("target", "@a").strip() or "@a"

            if not text:
                self.send_error_json("Treść wiadomości nie może być pusta.")
                return

            escaped_text = json.dumps(text)
            if mode == "title":
                rcon_cmd_to_run = f'title {target} title {{"text":{escaped_text},"color":"red","bold":true}}'
            elif mode == "actionbar":
                rcon_cmd_to_run = f'title {target} actionbar {{"text":{escaped_text},"color":"green","bold":true}}'
            elif mode == "whisper" or (target != "@a"):
                rcon_cmd_to_run = f'tellraw {target} [{{"text":"[Admin -> TY] ","color":"gold","bold":true}},{{"text":{escaped_text},"color":"white"}}]'
            else:
                rcon_cmd_to_run = f'tellraw @a [{{"text":"[Admin] ","color":"red","bold":true}},{{"text":{escaped_text},"color":"yellow"}}]'

            resp = rcon_command(rcon_cmd_to_run)

            now_time = time.strftime("%H:%M:%S")
            with admin_chat_lock:
                admin_chat_messages.append({
                    "id": f"adm_{time.time()}",
                    "time": now_time,
                    "type": "admin",
                    "sender": "Admin",
                    "text": text,
                    "mode": mode,
                    "target": target
                })
                if len(admin_chat_messages) > 120:
                    admin_chat_messages.pop(0)

            self.send_json({"success": True, "message": "Wysłano wiadomość", "response": resp})
            return

        elif path == "/api/mod/toggle":
            rel_path = data.get("path", "").strip().lstrip("/")
            target_file = (MC_DIR / rel_path).resolve()
            try:
                target_file.relative_to(MC_DIR.resolve())
            except ValueError:
                self.send_error_json("Path outside /opt/minecraft", 403)
                return

            if not target_file.exists():
                self.send_error_json("Mod file not found", 404)
                return

            try:
                if target_file.name.endswith(".jar"):
                    new_path = target_file.with_name(target_file.name + ".disabled")
                    target_file.rename(new_path)
                    self.send_json({"success": True, "enabled": False, "new_path": str(new_path.name)})
                elif target_file.name.endswith(".disabled"):
                    new_path = target_file.with_name(target_file.name[:-9])
                    target_file.rename(new_path)
                    self.send_json({"success": True, "enabled": True, "new_path": str(new_path.name)})
                else:
                    self.send_error_json("Not a mod jar file")
            except Exception as e:
                self.send_error_json(f"Error toggling mod: {str(e)}")
            return

        elif path == "/api/mod/backup":
            rel_path = data.get("path", "").strip().lstrip("/")
            target_file = (MC_DIR / rel_path).resolve()
            try:
                target_file.relative_to(MC_DIR.resolve())
            except ValueError:
                self.send_error_json("Path outside /opt/minecraft", 403)
                return

            if not target_file.exists():
                self.send_error_json("File not found", 404)
                return

            backup_dir = MC_DIR / "mods" / ".backup"
            backup_dir.mkdir(parents=True, exist_ok=True)
            new_dest = backup_dir / target_file.name
            try:
                shutil.move(str(target_file), str(new_dest))
                self.send_json({"success": True, "message": f"Moved {target_file.name} to .backup/"})
            except Exception as e:
                self.send_error_json(f"Failed to backup mod: {str(e)}")
            return

        self.send_error_json("Endpoint not found", 404)

    def upload_mod(self, query):
        name = query.get("filename", [""])[0]
        if not valid_mod_name(name):
            self.send_error_json("Invalid filename; select a .jar file", 400)
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            size = 0
        if not 0 < size <= MAX_MOD_BYTES:
            self.send_error_json("File must be between 1 byte and 256 MB", 413)
            return

        mods_dir = MC_DIR / "mods"
        mods_dir.mkdir(parents=True, exist_ok=True)
        destination = mods_dir / name
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=mods_dir, suffix=".uploading", delete=False) as output:
                temporary = Path(output.name)
                remaining = size
                while remaining:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise ValueError("Upload ended before the declared size")
                    output.write(chunk)
                    remaining -= len(chunk)

            if not valid_mod_jar(temporary):
                self.send_error_json("The file is not a recognized Forge/Fabric/Quilt mod", 400)
                return
            with upload_lock:
                if destination.exists():
                    self.send_error_json("A mod with this filename already exists", 409)
                    return
                os.replace(temporary, destination)
                temporary = None
            self.send_json({"success": True, "name": name, "size": size, "restart_required": True}, 201)
        except (OSError, ValueError) as e:
            self.send_error_json(f"Upload failed: {e}", 500)
        finally:
            if temporary:
                temporary.unlink(missing_ok=True)

def run():
    if not AUTH_USER or not AUTH_PASSWORD:
        raise SystemExit("Set auth_user/auth_password in config.json or DASHBOARD_USER/DASHBOARD_PASSWORD")
    # Start background telemetry poller
    t = threading.Thread(target=telemetry_poller, daemon=True)
    t.start()

    server_address = ("0.0.0.0", PORT)
    httpd = http.server.ThreadingHTTPServer(server_address, CyberHandler)
    print(f"[GRZYBKOWO CYBER-OPS] Minecraft Dashboard listening on http://0.0.0.0:{PORT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[GRZYBKOWO CYBER-OPS] Shutting down.")
        httpd.server_close()

if __name__ == "__main__":
    run()
