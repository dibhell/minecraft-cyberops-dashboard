# 📡 Dokumentacja REST API // Grzybkowo Cyber-Ops

Wszystkie zapytania API przyjmują i zwracają dane w formacie `application/json`.
Domyślny adres bazowy: `http://192.168.1.15:8080`

---

## 1. Status i Telemetria

### `GET /api/status`
Zwraca aktualny stan maszyny fizycznej, procesu Minecrafta oraz listę graczy.

**Przykładowa odpowiedź:**
```json
{
  "system": {
    "hostname": "Grzybkowo",
    "cpu_percent": 14.5,
    "temp": {
      "package": 47.0,
      "cores": [
        { "name": "Core 0", "temp": 46.0 },
        { "name": "Core 1", "temp": 46.0 }
      ]
    },
    "memory": {
      "total_bytes": 16697360384,
      "used_bytes": 4125818880,
      "free_bytes": 12571541504,
      "used_percent": 24.7,
      "swap_used_percent": 0.0
    },
    "disk": {
      "total_bytes": 105089261568,
      "used_bytes": 53305237504,
      "free_bytes": 46398537728,
      "used_percent": 50.7
    },
    "load_avg": [0.65, 0.88, 0.72],
    "uptime": "0d 14h 22m"
  },
  "minecraft": {
    "active": true,
    "state": "active",
    "sub_state": "running",
    "pid": 3705,
    "java_pid": 3706,
    "jvm_memory_mb": 3410.2,
    "players": {
      "count": 1,
      "max": 8,
      "list": ["grzybeksigma67"]
    },
    "uptime": "Thu 2026-09-10 19:01:26 CEST"
  },
  "timestamp": 1789067520.12
}
```

---

## 2. Czat i Komunikacja z Graczami

### `GET /api/chat?limit=80`
Pobiera uporządkowaną chronologicznie listę wiadomości czatu, zdarzeń graczy (dołączenie/wyjście) oraz komunikatów administratora.

**Parametry Query:**
* `limit` (opcjonalny, domyślnie `80`): Liczba ostatnich wiadomości.

**Przykładowa odpowiedź:**
```json
{
  "messages": [
    {
      "id": "p_21:07:09_grzybeksigma67_198421873",
      "time": "21:07:09",
      "type": "player",
      "sender": "grzybeksigma67",
      "text": "spoko, zaraz będe"
    },
    {
      "id": "adm_1789067530.12",
      "time": "21:14:54",
      "type": "admin",
      "sender": "Admin",
      "text": "Witajcie! Konsola jest połączona.",
      "mode": "chat",
      "target": "@a"
    }
  ]
}
```

---

### `POST /api/chat/send`
Wysyła wiadomość do graczy na serwerze z automatycznym formatowaniem prefiksu `[Admin]`.

**Body (JSON):**
```json
{
  "text": "Uwaga! Szalona krowa w pobliżu!",
  "mode": "chat",
  "target": "@a"
}
```

**Dostępne tryby (`mode`):**
* `"chat"` – Czat standardowy (komunikat JSON `tellraw` z czerwonym `[Admin]`).
* `"title"` – Wielki napis na środku ekranu (`title <target> title ...`).
* `"actionbar"` – Powiadomienie nad paskiem ekwipunku (`title <target> actionbar ...`).
* `"whisper"` – Prywatny szept do wybranego gracza (`target`).

**Odpowiedź:**
```json
{
  "success": true,
  "message": "Wysłano wiadomość",
  "response": ""
}
```

---

## 3. Wykonywanie Komend Serwera

### `POST /api/rcon`
Bezpośrednie wykonanie komendy Minecrafta przez protokół RCON.

**Body (JSON):**
```json
{
  "command": "time set day"
}
```

**Odpowiedź:**
```json
{
  "command": "time set day",
  "response": "Set the time to 1000",
  "success": true
}
```

---

## 4. Zarządzanie Usługą Serwera

### `POST /api/server/control`
Wysyła polecenie kontroli do jednostki systemd `minecraft.service`.

**Body (JSON):**
```json
{
  "action": "restart"
}
```

**Dostępne akcje (`action`):**
* `"start"` – Uruchomienie serwera.
* `"stop"` – Bezpieczne wyłączenie (SIGINT, zapis świata).
* `"restart"` – Przeładowanie serwera.
* `"kill"` – Wymuszone ubicie zawieszonego procesu (`pkill -9 -f forge`).

---

## 5. Eksplorator Plików

### `GET /api/files?path=mods`
Zwraca listę plików i podkatalogów w żądanej ścieżce wewnątrz `/opt/minecraft`.

**Odpowiedź:**
```json
{
  "current_path": "mods",
  "items": [
    {
      "name": "crazycow-2.3.0.jar",
      "rel_path": "mods/crazycow-2.3.0.jar",
      "is_dir": false,
      "size": 114752,
      "mtime": 1789059551,
      "is_jar": true,
      "is_disabled_jar": false
    }
  ]
}
```

### `GET /api/file/read?path=server.properties`
Pobiera zawartość tekstową pliku konfiguracyjnego (limit bezpieczeństwa: 2 MB).

---

## 6. Zarządzanie Modami

### `GET /api/mods`
Zwraca listę modów zainstalowanych w `/opt/minecraft/mods`.

### `POST /api/mod/toggle`
Przełącza stan moda poprzez zmianę rozszerzenia pliku (`.jar` ↔ `.jar.disabled`).
```json
{
  "path": "mods/crazycow-2.3.0.jar"
}
```

### `POST /api/mod/backup`
Przenosi plik moda do folderu kopii zapasowej `/opt/minecraft/mods/.backup/`.
