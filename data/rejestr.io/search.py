import firebase_admin
from firebase_admin import db
from db import KRSs


def list_missing_people():
    companies = db.reference("/external/rejestr-io/krs/").get()
    assert isinstance(companies, dict)
    
    people = db.reference("/external/rejestr-io/person/").get()
    assert isinstance(people, dict)
    
    companies_to_ingest = set()
    people_missing = set()
    
    for id, company in companies.items():
        for person, status in company.get("connections", {}).items():
            if person not in people:
                print(f"{id} contains {person}, but it's not in DB")
                companies_to_ingest.add((id, status["state"]))
                people_missing.add(person)
                
    # TODO actually reprocess
    print(companies_to_ingest)
    print(people_missing)
    print(f"{len(companies_to_ingest)} companies to reprocess")
    print(f"{len(people_missing)} people missing")
    print(f"{("0000085139", "aktualne") in companies_to_ingest} - DOZAMEL")
    print(f"{"611633" in people_missing} - Jerzy Jankowski")

    
    


if __name__ == "__main__":
    list_missing_people()
