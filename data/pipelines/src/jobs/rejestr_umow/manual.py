import logging
import os
from typing import Any

from jobs.rejestr_umow.scraper.client import ApiClient
from jobs.rejestr_umow.scraper.runner import run
from jobs.rejestr_umow.scraper.storage import SqlAgreementRepository


def start_search(date_from, date_to, wojewodztwo) -> None:


    do_search = True
    do_details = False

    filters: dict[str, Any] = {}
    menu: dict[str, Any] = {}
    if date_from:
        menu["dataPublikacjiOd"] = date_from
    if date_to:
        menu["dataPublikacjiDo"] = date_to
    if menu:
        filters["menuGlowne"] = menu

    if wojewodztwo:
        filters["jsfp"] = {"wojewodztwo": wojewodztwo}

    with ApiClient(throttle=0.3) as client, \
            SqlAgreementRepository(dsn=os.environ["DATABASE_URL"]) as repo:
        run(
            client,
            repo,
            do_search=do_search,
            do_details=do_details,
            page_size=50,
            filters=filters,
            sort_key=None,
            start_offset=0,
            max_records=None,
            stop_on_existing=False,
            max_details=None,
        )


WOJEWODZTWA = [
    "Dolnośląskie",
    "Kujawsko-Pomorskie",
    "Lubelskie",
    "Lubuskie",
    "Łódzkie",
    "Małopolskie",
    "Mazowieckie",
    "Opolskie",
    "Podkarpackie",
    "Podlaskie",
    "Pomorskie",
    "Śląskie",
    "Świętokrzyskie",
    "Warmińsko-Mazurskie",
    "Wielkopolskie",
    "Zachodniopomorskie",
]
dates = [
    "2026-07-01",
    "2026-07-02",
    "2026-07-03",
    "2026-07-04",
    "2026-07-05",
    "2026-07-06",
    "2026-07-07",
    "2026-07-08",
    "2026-07-09",
    "2026-07-10",
    "2026-07-11",
    "2026-07-12",
    "2026-07-13",
    "2026-07-14",
    "2026-07-15",
    "2026-07-16",
    "2026-07-17",
    "2026-07-18",
    "2026-07-19",
    "2026-07-20",
    "2026-07-21",
    "2026-07-22",
    "2026-07-23",
    "2026-07-24",
    "2026-07-25",
    "2026-07-26",
    "2026-07-27",
    "2026-07-28",
    "2026-07-29",
    "2026-07-30",
    "2026-07-31",
    "2026-08-01",
    "2026-08-02",
    "2026-08-03",
    "2026-08-04",
    "2026-08-05",

]

def do_date(day):
    for w in WOJEWODZTWA:
        logging.info(f"{day=} |{w=}")
        start_search(date_from=day, date_to=day, wojewodztwo=w)


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    for day in dates[1:]:
        do_date(day)


if __name__ == '__main__':
    main()
