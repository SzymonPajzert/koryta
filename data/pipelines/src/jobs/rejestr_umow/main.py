"""CLI scrapera rejestrumow.gov.pl.

Przykłady:
    python main.py --max-records 20          # szybki smoke test
    python main.py                           # pełny scrape (search + detale)
    python main.py --search-only             # tylko lista umów
    python main.py --details-only            # tylko detale (dla już pobranej listy)
"""
from __future__ import annotations

import argparse
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

from jobs.rejestr_umow import config
from jobs.rejestr_umow.scraper.client import ApiClient
from jobs.rejestr_umow.scraper.runner import run
from jobs.rejestr_umow.scraper.storage import (
    AgreementRepository,
    JsonAgreementRepository,
    SqlAgreementRepository,
)

# Format daty wymagany przez API w ciele zapytania (np. "2026.07.01").
API_DATE_FORMAT = "%Y.%m.%d"


def _api_date(value: str) -> str:
    """Znormalizuj datę wejściową do formatu API (RRRR.MM.DD).

    Akceptuje RRRR-MM-DD, RRRR.MM.DD oraz DD.MM.RRRR.
    """
    for fmt in ("%Y-%m-%d", "%Y.%m.%d", "%d.%m.%Y"):
        try:
            return datetime.strptime(value, fmt).strftime(API_DATE_FORMAT)
        except ValueError:
            continue
    raise argparse.ArgumentTypeError(
        f"Nieprawidłowa data: {value!r} (użyj RRRR-MM-DD)"
    )


def build_filters(args: argparse.Namespace) -> Optional[dict[str, Any]]:
    """Zbuduj ciało filtrów wyszukiwania z zakresu dat i województwa.

    Zwraca np. {"menuGlowne": {"dataPublikacjiOd": "2026.07.01",
                               "dataPublikacjiDo": "2026.07.02"},
                "jsfp": {"wojewodztwo": "MAZOWIECKIE"}}
    albo None, gdy nie podano żadnego filtra.

    Flagi --today / --yesterday ustawiają oba ograniczenia na, odpowiednio,
    dzisiejszą lub wczorajszą datę (umowy zawarte danego dnia).
    """
    date_from = args.date_from
    date_to = args.date_to
    if args.today:
        day = datetime.now().strftime(API_DATE_FORMAT)
        date_from = date_to = day
    elif args.yesterday:
        day = (datetime.now() - timedelta(days=1)).strftime(API_DATE_FORMAT)
        date_from = date_to = day

    filters: dict[str, Any] = {}

    menu: dict[str, Any] = {}
    if date_from:
        menu["dataPublikacjiOd"] = date_from
    if date_to:
        menu["dataPublikacjiDo"] = date_to
    if menu:
        filters["menuGlowne"] = menu

    if args.wojewodztwo:
        filters["jsfp"] = {"wojewodztwo": args.wojewodztwo}

    return filters or None


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Scraper Rejestru Umów (rejestrumow.gov.pl)"
    )
    p.add_argument("--page-size", type=int, default=config.PAGE_SIZE,
                   help=f"Rozmiar strony wyszukiwania (domyślnie {config.PAGE_SIZE})")
    p.add_argument("--max-records", type=int, default=None,
                   help="Limit pobieranych pozycji wyszukiwania (do testów)")
    p.add_argument("--max-details", type=int, default=None,
                   help="Limit umów przetwarzanych w etapie detali (jeden przebieg)")
    p.add_argument("--offset", type=int, default=0,
                   help="Offset początkowy wyszukiwania (wznawianie)")
    p.add_argument("--incremental", action="store_true",
                   help="Tryb inkrementalny: przerwij wyszukiwanie po napotkaniu "
                        "umowy już obecnej w repozytorium (zakłada sortowanie od "
                        "najnowszych)")
    p.add_argument("--from", dest="date_from", type=_api_date, default=None,
                   metavar="RRRR-MM-DD",
                   help="Filtr: data zawarcia umowy OD (opcjonalny)")
    p.add_argument("--to", dest="date_to", type=_api_date, default=None,
                   metavar="RRRR-MM-DD",
                   help="Filtr: data zawarcia umowy DO (opcjonalny)")
    p.add_argument("--today", action="store_true",
                   help="Filtr: tylko umowy zawarte dziś (ustawia OD i DO na "
                        "dzisiejszą datę; nie łączyć z --from/--to)")
    p.add_argument("--yesterday", action="store_true",
                   help="Filtr: tylko umowy zawarte wczoraj (ustawia OD i DO na "
                        "wczorajszą datę; nie łączyć z --from/--to/--today)")
    p.add_argument("--wojewodztwo", type=str, default=None,
                   metavar="WOJEWODZTWO",
                   help="Filtr: województwo (ścieżka jsfp->wojewodztwo w zapytaniu, "
                        "np. MAZOWIECKIE)")
    p.add_argument("--sort-key", type=str, default=None,
                   help="Klucz sortowania przekazywany do API")
    p.add_argument("--data-dir", type=Path, default=config.DATA_DIR,
                   help="Katalog na dane wyjściowe JSON (backend json)")
    p.add_argument("--storage", choices=("json", "db"), default="db",
                   help="Backend zapisu: baza danych (domyślnie) lub pliki JSON")
    p.add_argument("--dsn", type=str, default=config.DATABASE_URL,
                   help="DSN połączenia z bazą (backend db)")
    p.add_argument("--throttle", type=float, default=config.THROTTLE_SECONDS,
                   help="Opóźnienie między żądaniami w sekundach")

    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--search-only", action="store_true",
                      help="Wykonaj tylko etap wyszukiwania")
    mode.add_argument("--details-only", action="store_true",
                      help="Wykonaj tylko etap pobierania detali")

    p.add_argument("-v", "--verbose", action="store_true", help="Logowanie DEBUG")
    args = p.parse_args()
    if args.today and args.yesterday:
        p.error("--today i --yesterday wykluczają się wzajemnie")
    if (args.today or args.yesterday) and (args.date_from or args.date_to):
        p.error("--today/--yesterday nie można łączyć z --from/--to")
    return args


def make_repository(args: argparse.Namespace) -> AgreementRepository:
    """Zbuduj repozytorium wskazanego backendu (json | db)."""
    if args.storage == "db":
        return SqlAgreementRepository(dsn=args.dsn)
    return JsonAgreementRepository(data_dir=args.data_dir)


def main() -> None:
    args = parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    do_search = not args.details_only
    do_details = not args.search_only

    with ApiClient(throttle=args.throttle) as client, \
            make_repository(args) as repo:
        run(
            client,
            repo,
            do_search=do_search,
            do_details=do_details,
            page_size=args.page_size,
            filters=build_filters(args),
            sort_key=args.sort_key,
            start_offset=args.offset,
            max_records=args.max_records,
            stop_on_existing=args.incremental,
            max_details=args.max_details,
        )


if __name__ == "__main__":
    main()
