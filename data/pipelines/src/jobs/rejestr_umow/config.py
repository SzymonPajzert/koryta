"""Konfiguracja scrapera rejestrumow.gov.pl.

Wszystkie stałe w jednym miejscu, aby łatwo je zmieniać bez grzebania w logice.
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# Wczytaj zmienne z pliku .env (jeśli istnieje) do środowiska procesu.
# Zmienne już ustawione w środowisku mają pierwszeństwo (override=False).
load_dotenv()

# --- API ---------------------------------------------------------------------
BASE_URL = "https://rejestrumow.gov.pl"
SEARCH_PATH = "/api-dp/v1/agreements/search"      # POST
DETAILS_PATH = "/api-dp/v1/agreement"             # GET /{idUmowy}

# --- Zachowanie klienta HTTP -------------------------------------------------
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/125.0.0.0 Safari/537.36 rejestrumow-scraper/1.0"
)
PAGE_SIZE = 50            # rozmiar strony wyszukiwania
SEARCH_BATCH_SIZE = 500   # ile pozycji wyszukiwania zapisywać jednym zapytaniem
DETAILS_BATCH_SIZE = 100  # ile detali umów zapisywać jedną transakcją wsadową
THROTTLE_SECONDS = 0.3    # opóźnienie między żądaniami (grzeczność wobec CDN)
MAX_RETRIES = 5           # liczba prób przy 429/5xx/błędach sieci
BACKOFF_BASE = 1.0        # bazowe opóźnienie backoffu (sekundy)
REQUEST_TIMEOUT = 30      # timeout pojedynczego żądania (sekundy)

# --- Zapis -------------------------------------------------------------------
DATA_DIR = Path(__file__).resolve().parent / "data"

# --- Baza danych (backend SQL) -----------------------------------------------
# DSN do PostgreSQL. Domyślnie łączy się lokalnie z bazą `rejestr_umow`
# (utworzoną skryptami z katalogu `sql/`). Hasło/host podawaj przez zmienne
# środowiskowe (DATABASE_URL lub standardowe PGHOST/PGUSER/PGPASSWORD/...),
# nie trzymaj ich w repozytorium.
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql:///rejestr_umow")
