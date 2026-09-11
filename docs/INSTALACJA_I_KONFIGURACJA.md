# ⚙️ Instalacja i Konfiguracja // Grzybkowo Cyber-Ops

Szczegółowy przewodnik instalacji konsoli na serwerze Linux (Ubuntu / Debian).

---

## 📋 1. Wymagania Systemowe

* **System operacyjny:** Linux (testowano na Ubuntu 22.04 / 24.04 LTS).
* **Python:** Python 3.8+ (wykorzystuje wyłącznie bibliotekę standardową, **zero zależności pip**!).
* **Serwer Minecraft:** Dowolny serwer (Forge, Fabric, Paper, Vanilla) zarządzany przez systemd (`minecraft.service`).
* **Narzędzia diagnostyczne (opcjonalne):**
  ```bash
  sudo apt-get install lm-sensors
  sudo sensors-detect --auto
  ```

---

## 📂 2. Struktura Katalogów

Zalecana lokalizacja instalacji na serwerze:
```text
/opt/minecraft/
├── dashboard/
│   ├── config.json              # Plik konfiguracyjny (lokalny, zignorowany przez git)
│   ├── config.example.json      # Szablon konfiguracji
│   ├── server.py                # Backend serwera HTTP / RCON / Telemetria
│   ├── minecraft-dashboard.service # Jednostka systemd
│   └── web/
│       ├── index.html           # Interfejs SPA
│       ├── style.css            # Style Cyberpunk / Scanlines / Glow
│       └── app.js               # Silnik JavaScript / Audio / SSE Polling
├── mods/                        # Folder z modami Forge
├── logs/
│   └── latest.log               # Główny log gry streamowany do czatu
└── server.properties            # Konfiguracja serwera Minecraft i RCON
```

---

## 🔧 3. Konfiguracja (`config.json`)

Skopiuj plik szablonu:
```bash
cp config.example.json config.json
```

Zawartość `config.json`:
```json
{
  "mc_dir": "/opt/minecraft",
  "sudo_pass": "TWOJE_HASLO_SUDO",
  "port": 8080,
  "auth_user": "admin",
  "auth_password": "DLUGIE_LOSOWE_HASLO"
}
```

### Zmienne Środowiskowe (Alternatywa)
Parametry można również przekazać przez zmienne systemowe:
* `MC_DIR`: Ścieżka do folderu Minecrafta (domyślnie `/opt/minecraft`).
* `SUDO_PASS`: Hasło użytkownika do wywoływania `sudo systemctl ...`.
* `PORT`: Port HTTP dashboardu (domyślnie `8080`).
* `DASHBOARD_USER`: Login do panelu (domyślnie `admin`).
* `DASHBOARD_PASSWORD`: Hasło do panelu; bez niego usługa nie wystartuje.

---

## 🔒 4. Konfiguracja RCON w `server.properties`

Aby konsola czatu i komend mogła komunikować się z serwerem gry, upewnij się, że w `/opt/minecraft/server.properties` włączony jest RCON:
```properties
enable-rcon=true
rcon.port=25575
rcon.password=TwojeSilneHasloRcon
broadcast-rcon-to-ops=false
```
*Dashboard automatycznie odczytuje hasło i port RCON z pliku `server.properties`.*

---

## 🚀 5. Instalacja jako Usługa Systemowa (systemd)

1. Skopiuj plik jednostki do `/etc/systemd/system/`:
   ```bash
   sudo cp minecraft-dashboard.service /etc/systemd/system/
   ```

2. Przeładuj konfigurację demona systemd:
   ```bash
   sudo systemctl daemon-reload
   ```

3. Włącz automatyczny start przy bootowaniu systemu i uruchom usługę:
   ```bash
   sudo systemctl enable --now minecraft-dashboard.service
   ```

4. Sprawdź status usługi:
   ```bash
   sudo systemctl status minecraft-dashboard.service
   ```

---

## 🛡️ 6. Konfiguracja Zapory Sieciowej (UFW)

Jeśli na serwerze aktywny jest firewall `ufw`, otwórz port panelu:
```bash
sudo ufw allow 8080/tcp comment 'Grzybkowo Cyber-Ops Dashboard'
```

---

## 🛠️ 7. Zarządzanie i Diagnostyka

* **Podgląd logów dashboardu w czasie rzeczywistym:**
  ```bash
  journalctl -u minecraft-dashboard.service -f
  ```
* **Restart usługi:**
  ```bash
  sudo systemctl restart minecraft-dashboard.service
  ```
* **Zatrzymanie usługi:**
  ```bash
  sudo systemctl stop minecraft-dashboard.service
  ```
