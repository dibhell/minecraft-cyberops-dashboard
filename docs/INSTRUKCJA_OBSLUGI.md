# 📖 Instrukcja Obsługi // Grzybkowo Cyber-Ops

Podręcznik użytkownika konsoli operacyjnej serwera Minecraft Forge **Grzybkowo**.

---

## 🌐 1. Dostęp do Dashboardu

Konsola działa jako usługa w sieci lokalnej pod adresem:
- **Przeglądarka (z dowolnego urządzenia w LAN):** `http://192.168.1.15:8080` (lub `http://grzybkowo:8080`)
- **Urządzenia mobilne:** Możesz otworzyć ten sam adres na telefonie lub tablecie podłączonym do domowego Wi-Fi.

---

## 🖥️ 2. Pasek Górny i Telemetria Główna

Na samej górze ekranu znajduje się monitor stanu maszyny i serwera:
* **Zegar Cybernetyczny:** Czas z dokładnością do milisekund.
* **Przełącznik CRT:** Włącza/wyłącza retro-efekt linii skanujących monitora kineskopowego.
* **Przełącznik SFX:** Włącza/wyłącza syntetyzowane dźwięki interfejsu (Web Audio API).
* **Wskaźnik Ping / Latency:** Opóźnienie zapytania do serwera w milisekundach.

### Karty Wskaźników (HUD):
1. **MINECRAFT CORE (SYS.01):**
   - Status: `ONLINE` (zielony) / `OFFLINE` (czerwony).
   - Liczba graczy online: np. `2 / 8` wraz z pigułkami z nickami graczy.
   - JVM PID: Identyfikator procesu maszyny wirtualnej Javy.
   - JVM RAM: Ilość pamięci fizycznej (RSS) zajmowanej przez Minecraft Forge (np. ~3.4 GB).
2. **CPU PROCESSOR (SYS.02):**
   - Procentowe obciążenie procesora w czasie rzeczywistym.
   - Wskaźniki Load Average (1m / 5m).
   - Całkowity czas pracy systemu Linux (Uptime).
3. **THERMAL MATRIX (SYS.03):**
   - Temperatura pakietu CPU oraz poszczególnych rdzeni w czasie rzeczywistym z czujników `lmsensors`.
   - Wskaźnik stanu: `OPTIMAL` (<65°C), `ELEVATED` (65–80°C), `CRITICAL` (>80°C).
4. **RAM & STORAGE (SYS.04):**
   - Zużycie pamięci RAM systemu (np. 4.1 / 16.0 GB).
   - Zużycie partycji dyskowej `/opt/minecraft`.

---

## 🎮 3. Panel Kontroli Serwera (Tactical Action Deck)

Przyciski szybkiej reakcji:
* **URUCHOM SERWER:** Startuje usługę `minecraft.service` przez systemd. Aktywny, gdy serwer jest wyłączony.
* **RESTARTUJ SERWER:** Bezpiecznie restartuje serwer Forge. Przeładowuje mody oraz aktualizuje sumy kontrolne paczki AutoModpack dla graczy.
* **ZATRZYMAJ (GRACEFUL):** Wysyła sygnał `SIGINT` do Minecrafta. Serwer bezpiecznie rozłącza graczy, zapisuje chunki świata i wyłącza proces.
* **FORCE KILL:** Awaryjne zabicie procesu (`pkill -9`), gdyby serwer uległ całkowitemu zawieszeniu.

---

## 💬 4. Dedykowana Konsola Czatu z Graczami (`Tab 01`)

Zaprojektowana specjalnie do bezpośredniej interakcji z graczami w grze bez oglądania technicznych logów.

### Strumień wiadomości:
* **Wiadomości od graczy:** Wyświetlane w czytelnych kartach z nickiem gracza (`👤 grzybeksigma67`), czasem wysłania i treścią.
* **Wiadomości Administratora:** Wyróżnione karty ze złotą koroną `👑 [ADMIN]`.
* **Zdarzenia serwerowe:** Informacje o dołączeniu gracza (`🟢 dołączył do gry`) lub opuszczeniu serwera (`🔴 opuścił grę`).
* **Dźwięk powiadomienia:** Po nadejściu nowej wiadomości od gracza panel odtwarza cybernetyczny gong (można wyciszyć przyciskiem `DŹWIĘK CZATU [OFF]`).
* **Licznik nieprzeczytanych:** Jeśli przeglądasz inną zakładkę, na karcie czatu pojawi się czerwona plakietka (np. `2 NOWE`).

### 4 Tryby Wysyłania Wiadomości:
1. 💬 **Czat standardowy [Admin]:** Wiadomość trafia na czat gry z wyróżnionym czerwonym prefiksem `[Admin]` i żółtym tekstem.
2. 📢 **Tytuł na środku (Title):** Wyświetla wielki, animowany czerwony napis na środku ekranu wszystkich graczy.
3. ⚡ **Pasek nad ekwipunkiem (Actionbar):** Dyskretna zielona wiadomość nad paskiem zdrowia/itemów.
4. 🤫 **Prywatna wiadomość (PW):** Wiadomość widoczna wyłącznie dla wybranego gracza jako `[Admin -> TY]`.

### Wybór Adresata (DO):
* Domyślnie: `Wszyscy gracze (@a)`.
* Menu rozwijane automatycznie uzupełnia się o graczy aktualnie połączonych z serwerem.

### Szybkie Odpowiedzi (Quick Replies):
Pigułki pod polem tekstowym pozwalają jednym kliknięciem wysłać popularne komunikaty:
- `👋 Siemanko!`
- `🐮 Szalona Krowa!`
- `⏳ Restart za 5 min`
- `👍 Miłej gry!`
- `☀️ Dzień!`

### Panel Boczny Graczy Online:
Obok czatu widoczna jest lista graczy online. Kliknięcie przycisków przy graczu wywołuje akcję:
* **`💬 PW`** – Przełącza pole pisania na prywatny szept do tego gracza.
* **`⚡ TP`** – Teleportuje do gracza.
* **`💎 Diament`** – Nagradza gracza 1 diamentem.
* **`⭐ OP`** – Nadaje uprawnienia administratora w grze.
* **`👢 Kick`** – Wyrzuca gracza z serwera.

---

## 💻 5. Konsola Administracyjna i Logi (`Tab 02`)

* **Podgląd logów na żywo:** Automatycznie streamuje zawartość `/opt/minecraft/logs/latest.log` z kolorowaniem `[INFO]`, `[WARN]`, `[ERROR]`, `AutoModpack` oraz `crazycow`.
* **Filtr logów:** Pole wyszukiwania umożliwiające odfiltrowanie wpisów np. tylko z danego moda.
* **Auto-Scroll:** Możliwość zatrzymania przewijania przy analizowaniu błędów.
* **Wiersz poleceń `admin@grzybkowo#`:**
  - Wpisanie dowolnej komendy Minecrafta (np. `time set day`, `weather clear`, `op gracz`, `gamemode creative`).
  - **Historia komend:** Klawisze **Strzałka w górę (↑)** oraz **Strzałka w dół (↓)** przywracają poprzednio wpisane polecenia.

---

## 📁 6. Eksplorator Plików (`Tab 03`)

* **Nawigacja:** Drzewo katalogów `/opt/minecraft` z wygodnym paskiem ścieżki (breadcrumbs).
* **Bezpieczeństwo:** Izolacja ścieżek uniemożliwia wyjście poza katalog główny serwera.
* **Szybki podgląd plików konfiguracyjnych:** Kliknięcie pliku tekstowego (np. `server.properties`, `ops.json`, `whitelist.json`, `eula.txt`) otwiera okno modalne z kodem i przyciskiem **SKOPIUJ TREŚĆ**.

---

## 📦 7. Arsenał Modów (`Tab 04`)

Zarządzanie katalogiem `/opt/minecraft/mods`:
* **Włączanie / Wyłączanie:** Przycisk zmienia rozszerzenie pliku z `.jar` na `.jar.disabled` i odwrotnie bez konieczności usuwania pliku z dysku.
* **Kopia zapasowa (.backup):** Bezpieczne przeniesienie starej wersji moda do podfolderu `.backup/`.
* *Uwaga:* Po zmianie modów należy zrestartować serwer przyciskiem w panelu akcji, aby Forge załadował nowe pliki, a AutoModpack zaktualizował paczkę dla graczy.

---

## 📊 8. Pełna Telemetria (`Tab 05`)

Surowy zrzut danych diagnostycznych:
* Pełna struktura drzewa czujników `lmsensors` w formacie JSON (napięcia, temperatury rdzeni, płyty).
* Statystyki pamięci podręcznej i buforów jądra z `/proc/meminfo`.
* Szczegółowe metryki partycji dyskowych.
