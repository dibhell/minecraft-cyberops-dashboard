# 🏛️ Architektura Systemu // Grzybkowo Cyber-Ops

Opis wewnętrznej struktury technicznej, decyzji architektonicznych oraz przepływu danych w konsoli **Grzybkowo Cyber-Ops**.

---

## 📐 1. Diagram Architektury

```
+-------------------------------------------------------------------------+
|                       PRZEGLĄDARKA KLIENTA (SPA)                         |
|   HTML5 + Vanilla CSS (Cyberpunk / CRT Scanlines) + Vanilla JS Engine    |
|   Web Audio API (Syntetyzator SFX) + Auto-Polling Telemetrii & Czatu    |
+-------------------------------------------------------------------------+
                                    │  ▲
              HTTP / REST (Port 8080)│  │ JSON Responses
                                    ▼  │
+-------------------------------------------------------------------------+
|                  BACKEND DAEMON (server.py // PYTHON 3)                 |
|   Zero-Dependency: ThreadingHTTPServer (Czysta biblioteka standardowa)  |
+-----------------------------------+-------------------------------------+
        │                           │                           │
        ▼                           ▼                           ▼
+-----------------+       +-------------------+       +-----------------+
| WĄTEK TELEMETRII|       |   SILNIK CZATU    |       |   KLIENT RCON   |
|  (Daemon 1.5s)  |       |  Log Parser Feed  |       | (Socket TCP/IP) |
+-----------------+       +-------------------+       +-----------------+
        │                           │                           │
        ▼                           ▼                           ▼
┌───────────────┐         ┌───────────────────┐       ┌─────────────────┐
│ System Linux: │         │ /opt/minecraft/   │       │ Minecraft Forge │
│ - /proc/stat  │         │ logs/latest.log   │       │ Serwer TCP:     │
│ - /proc/mem   │         │ (Analiza regexowa │       │ 127.0.0.1:25575 │
│ - lmsensors   │         │  w czasie rzecz.) │       │                 │
│ - systemctl   │         └───────────────────┘       └─────────────────┘
└───────────────┘
```

---

## ⚡ 2. Kluczowe Zasady Projektowe

### A. Zero Zależności (No Pip / No NPM Build Step)
Backend został napisany wyłącznie przy użyciu **biblioteki standardowej Python 3** (`http.server`, `socket`, `struct`, `subprocess`, `json`, `threading`, `pathlib`).
* **Zalety:** Uruchamia się natychmiast na dowolnej dystrybucji Linuksa, zużywa zaledwie ~2.8 MB pamięci RAM, nie wymaga tworzenia wirtualnych środowisk `venv` ani instalacji paczek przez `pip`, co eliminuje podatności na zmiany w ekosystemie.

### B. Asynchroniczny Cache Telemetryczny
Zamiast uruchamiać ciężkie polecenia systemowe (`sensors`, `systemctl`, `proc/stat`) przy każdym żądaniu klienta z przeglądarki, backend posiada dedykowany wątek roboczy (`telemetry_poller`), który aktualizuje dane co 1.5 sekundy w tle.
* **Czas odpowiedzi endpointu `/api/status`:** poniżej **3 milisekund**!

### C. Silnik Parsowania Czatu i Zdarzeń Gry
Wiadomości od graczy nie wymagają instalowania dodatkowych wtyczek na serwerze:
* Parser analizuje na bieżąco plik `/opt/minecraft/logs/latest.log` za pomocą prekompilowanych wyrażeń regularnych (`CHAT_RE`, `EVENT_RE`).
* Każdej wiadomości przypisywany jest unikalny, stabilny skrót identyfikacyjny (`id`), co zapobiega powielaniu powiadomień dźwiękowych w przeglądarce.
* Wiadomości administratora wysyłane przez panel są automatycznie wplatane w strumień czatu i formatowane w grze jako JSON `tellraw`.

### D. Wbudowany Klient Protokołu Source RCON
Komunikacja z konsolą gry odbywa się bezpośrednio przez binarny protokół **Source RCON** zaimplementowany na gniazdach TCP (`socket` + `struct`):
1. Pakiet autoryzacji (Typ 3) z hasłem odczytanym bezpośrednio z `server.properties`.
2. Pakiet wykonania polecenia (Typ 2).
3. Usunięcie kodów formatowania kolorów Minecrafta (`§`) dla czystego widoku w konsoli.

### E. Bezpieczeństwo i Izolacja Ścieżek
* **Ochrona przed Directory Traversal:** Eksplorator plików rygorystycznie sprawdza każdą relatywną ścieżkę (`Path.relative_to(MC_DIR)`). Żadne zapytanie nie może odczytać ani wylistować plików spoza katalogu `/opt/minecraft`.
* **Kopie zapasowe modów:** Funkcja usunięcia moda przenosi go do podkatalogu `/opt/minecraft/mods/.backup/` zamiast trwale kasować plik z dysku.
* **Separacja sekretów:** Hasła i konfiguracje środowiskowe znajdują się w `config.json` zignorowanym przez repozytorium git.
