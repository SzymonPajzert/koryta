"""Fetch all notes from koryta.pl API and save to CSV."""

import csv
import sys

import requests


BASE_URL = "https://autopush.koryta.pl/api/notes"
OUTPUT = "koryta_notes.csv"


def fetch_all_notes() -> list[dict]:
    notes = []
    page = 1
    while True:
        resp = requests.get(BASE_URL, params={"page": page}, timeout=10)
        resp.raise_for_status()
        data = resp.json()

        items = data.get("notes", data) if isinstance(data, dict) else data
        if not items:
            break

        notes.extend(items)
        print(f"Page {page}: got {len(items)} notes (total so far: {len(notes)})", file=sys.stderr)

        total = data.get("total") if isinstance(data, dict) else None
        if total and len(notes) >= total:
            break

        page += 1

    return notes


def main():
    notes = fetch_all_notes()
    if not notes:
        print("No notes fetched.", file=sys.stderr)
        return

    fieldnames = list(notes[0].keys())
    with open(OUTPUT, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(notes)

    print(f"Saved {len(notes)} notes to {OUTPUT}")


if __name__ == "__main__":
    main()
