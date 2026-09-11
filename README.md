# 🍄 GRZYBKOWO // MINECRAFT CYBER-OPS CONSOLE

[![Python Version](https://img.shields.io/badge/python-3.8%2B-00f0ff?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![Minecraft Version](https://img.shields.io/badge/Minecraft-Forge%201.20.1-00ff88?style=for-the-badge&logo=minecraft&logoColor=white)](https://files.minecraftforge.net/)
[![Architecture](https://img.shields.io/badge/dependencies-ZERO%20PIP-b940ff?style=for-the-badge)](docs/ARCHITEKTURA.md)
[![License](https://img.shields.io/badge/license-MIT-ffb800?style=for-the-badge)](LICENSE)

> **Nowoczesny, lekki panel operatorski i komunikator z graczami na żywo dla dedykowanych serwerów Minecraft (Forge / Fabric / Paper / Vanilla) w klimacie Cyberpunk / Hacker Terminal.**

Działa bezpośrednio na maszynie serwera (Linux Ubuntu/Debian) i umożliwia pełną kontrolę nad procesem gry, czatem z graczami, telemetrią sprzętową oraz plikami konfiguracyjnymi z dowolnej przeglądarki w sieci LAN.

---

## ✨ Główne Funkcje

* 💬 **Dedykowana Konsola Czatu z Graczami:**
  - Dwukierunkowy czat w czasie rzeczywistym bez oglądania technicznego szumu konsoli.
  - Automatyczne formatowanie wiadomości w grze jako **`[Admin]`** (kolorowy JSON `tellraw`).
  - 4 tryby nadawania: Czat ogólny, Tytuł na środku ekranu (**Title**), Pasek nad ekwipunkiem (**Actionbar**) oraz Prywatny szept (**PW**).
  - Prawy pasek graczy online z szybkimi akcjami (PW, Teleport, Daj diament, Daj OP, Wyrzuć/Kick).
  - Dźwiękowe powiadomienia Web Audio API przy nowej wiadomości od gracza i licznik nieprzeczytanych.
* 🖥️ **Centrum Kontroli Serwera (Tactical Action Deck):**
  - Uruchamianie, bezpieczny restart (z zapisem świata i przeładowaniem modów) oraz zatrzymanie usługi `minecraft.service`.
  - Awaryjne wymuszenie zatrzymania (**Force Kill**).
  - Szybkie komendy globalne (Ustaw dzień, Czysta pogoda, Zapisz świat).
* 📈 **Telemetria Sprzętowa i JVM w Czasie Rzeczywistym:**
  - Odczyt temperatur procesora z czujników `lmsensors` (temperatura pakietu oraz poszczególnych rdzeni) ze wskaźnikiem Optymalna/Podwyższona/Krytyczna.
  - Wykorzystanie pamięci RAM maszyny oraz pamięci fizycznej (RSS) zajmowanej przez JVM Forge.
  - Wykorzystanie procesora (CPU %) i Load Average (1m / 5m).
  - Zużycie partycji dyskowej `/opt/minecraft`.
* 💻 **Konsola Administracyjna i Podgląd Logów:**
  - Automatycznie streamowany plik `latest.log` z kolorowaniem składni i filtrem wyszukiwania na żywo.
  - Wiersz poleceń `admin@grzybkowo#` ze wsparciem dla historii komend (strzałki ↑/↓).
* 📁 **Eksplorator Plików i Konfiguracji:**
  - Bezpieczne przeglądanie struktury `/opt/minecraft`.
  - Podgląd plików konfiguracyjnych (`server.properties`, `ops.json`, `eula.txt`) w oknie modalnym z kopiowaniem do schowka.
* 📦 **Arsenał Modów:**
  - Lista zainstalowanych modów Forge.
  - Wgrywanie plików `.jar` z przeglądarki z kontrolą nazwy, rozmiaru i struktury moda.
  - Szybkie wyłączanie/włączanie modów (`.jar` ↔ `.jar.disabled`) bez ich usuwania.
* 🔒 **Dostęp chroniony:** cały panel i API wymagają loginu i hasła HTTP Basic.
* 🎨 **Aestetyka Cyberpunk / Sci-Fi Terminal:**
  - Przełącznik CRT Scanlines (efekt monitora kineskopowego).
  - Wbudowany syntezator dźwięków kliknięć i potwierdzeń (Web Audio API, bez zewnętrznych plików audio!).
  - Zegar z milisekundami i wskaźnik opóźnienia ping.

---

## 🏗️ Architektura Zero-Dependency

Konsola została zaprojektowana zgodnie z filozofią minimalizmu i niezawodności:
* **Zero zewnętrznych bibliotek Python:** Całość opiera się wyłącznie na standardowej bibliotece (`http.server`, `socket`, `struct`, `threading`, `json`).
* **Zaalokowana pamięć:** zaledwie ~2.8 MB RAM.
* **Czas odpowiedzi API:** < 3 ms dzięki wątkowi roboczemu buforującemu telemetrię w pamięci RAM.
* **Komunikacja RCON:** Natywna implementacja protokołu Source RCON na gniazdach TCP.

Szczegółowy opis znajduje się w pliku [docs/ARCHITEKTURA.md](docs/ARCHITEKTURA.md).

---

## 🚀 Szybki Start

### 1. Klonowanie i przygotowanie konfiguracji
```bash
git clone https://github.com/dibhell/minecraft-cyberops-dashboard.git
cd minecraft-cyberops-dashboard

# Skopiuj szablon konfiguracji
cp config.example.json config.json
```

Dostosuj plik `config.json`:
```json
{
  "mc_dir": "/opt/minecraft",
  "sudo_pass": "TWOJE_HASLO_SUDO",
  "port": 8080,
  "auth_user": "admin",
  "auth_password": "DLUGIE_LOSOWE_HASLO"
}
```

### 2. Uruchomienie jako usługa systemd
```bash
sudo cp minecraft-dashboard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now minecraft-dashboard.service
```

Panel będzie dostępny pod adresem:
👉 **`http://<IP_SERWERA>:8080`** (np. `http://192.168.1.15:8080`)

---

## 📚 Dokumentacja Szczegółowa

Kompletne instrukcje i dokumentacja techniczna znajdują się w katalogu [`docs/`](docs/):

| Dokument | Opis |
| :--- | :--- |
| 📖 [**Instrukcja Obsługi**](docs/INSTRUKCJA_OBSLUGI.md) | Podręcznik użytkownika: obsługa czatu, tryby Title/Actionbar/PW, skróty klawiszowe, kontrola serwera. |
| ⚙️ [**Instalacja i Konfiguracja**](docs/INSTALACJA_I_KONFIGURACJA.md) | Wymagania systemowe, konfiguracja RCON, instalacja systemd, firewall UFW. |
| 📡 [**Dokumentacja REST API**](docs/API_DOCUMENTATION.md) | Opis wszystkich endpointów HTTP (`/api/status`, `/api/chat`, `/api/rcon`, `/api/files` itd.). |
| 🏛️ [**Architektura Systemu**](docs/ARCHITEKTURA.md) | Diagramy przepływu danych, zasada działania parsowania logów, klient RCON na socketach. |

---

## 📄 Licencja

Projekt objęty licencją **MIT**. Szczegóły w pliku [LICENSE](LICENSE).
