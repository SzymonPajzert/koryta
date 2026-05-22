from conductor import setup_context
from entities.company import ManualKRS
from entities.person import RejestrIOKey
from scrapers.krs.scrape import ScrapeRejestrIO


def test_people_to_scrape():
    ctx = setup_context(False)[0]
    scraper = ScrapeRejestrIO()
    scraped = scraper.people_to_scrape(ctx)

    # Konrad Zaradny is 5XM9lfVLrdvBODLJIrDM in Koryta
    # Let's find his RejestrIO ID from people_merged
    people_merged = scraper.people_all.read_or_process(ctx)
    # Fill NaN values with empty string for string containment check
    mask = people_merged["koryta_name"].fillna("").str.contains("Zaradny", case=False)
    zaradny_row = people_merged[mask]
    print("\nZaradny in people_merged:")
    if not zaradny_row.empty:
        print(zaradny_row[["koryta_name", "rejestrio_id", "krs_name", "wiki_name"]])
    else:
        print("No Zaradny found in people_merged using contains!")
        # Let's check people_krs directly
        krs_people = scraper.people.read_or_process(ctx)
        mask = krs_people["full_name"].fillna("").str.contains("Zaradny", case=False)
        print("\nZaradny in krs_people:")
        print(krs_people[mask][["full_name", "id"]])

    if not zaradny_row.empty:
        rejestr_ids = zaradny_row.iloc[0]["rejestrio_id"]
        print(f"Rejestr IO IDs for Zaradny: {rejestr_ids}")
        if len(rejestr_ids) > 0:
            expected_key = RejestrIOKey(id=str(rejestr_ids[0]))
            print(f"Expected Key: {expected_key}")
            assert expected_key in scraped, (
                "Konrad Zaradny's RejestrIOKey is NOT in scraped people!"
            )
            assert expected_key.id == "808738", (
                f"Expected ID 808738, got {expected_key.id}"
            )
    else:
        print("Konrad Zaradny not found in people_merged.")

    # Explicit check for 808738
    assert RejestrIOKey(id="808738") in scraped, (
        "RejestrIOKey for 808738 is missing from scraped people!"
    )

    # Also test KorytaVotes and KorytaPeople
    koryta_votes_df = scraper.koryta_votes.read_or_process(ctx)
    vote = koryta_votes_df[
        koryta_votes_df["person_koryta_id"] == "5XM9lfVLrdvBODLJIrDM"
    ]
    print("\nVote for Zaradny:")
    print(vote)


def test_companies_to_scrape_filtering():
    ctx = setup_context(False)[0]
    scraper = ScrapeRejestrIO()
    scraped = scraper.companies_to_scrape(ctx)

    # Test that 0000607833 which is already scraped is correctly filtered out
    assert ManualKRS(id="0000607833") not in scraped, (
        f"ManualKRS(0000607833) was NOT filtered out of companies_to_scrape: \
            {[c for c in scraped if c.id == '0000607833'][0].full_str()}"
    )
