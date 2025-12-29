import os
import sys
import requests
import pandas as pd
from scrapers.stores import Pipeline, Context
from analysis.people import PeopleEnriched

class KorytaUploader(Pipeline):
    filename = None 
    people_enriched: PeopleEnriched

    def process(self, ctx: Context):
        print("Reading enriched people...")
        df = self.people_enriched.read_or_process(ctx)
        
        # Sort by overall_score descending and take top 10
        # Check if overall_score exists
        if "overall_score" in df.columns:
            df = df.sort_values("overall_score", ascending=False).head(10)
        else:
            print("Warning: 'overall_score' column not found, taking first 10 rows.")
            df = df.head(10)
        
        target_url = "http://localhost:3000/api/person/bulk_create"
        if ctx.is_prod:
            target_url = "https://koryta.pl/api/person/bulk_create"
            print(f"WARNING: You are about to upload data to PRODUCTION ({target_url}).")
            # In standard python script assume stdin is connected
            try:
                confirm = input("Type 'YES' to confirm: ")
                if confirm != "YES":
                    print("Aborted.")
                    return pd.DataFrame()
            except EOFError:
                print("EOFError: cannot read input. Aborting.")
                return pd.DataFrame()

        token = os.environ.get("KORYTA_API_TOKEN", "")
        if not token and ctx.is_prod:
             print("Warning: KORYTA_API_TOKEN env var is missing. Upload might fail.")

        headers = {
            "Content-Type": "application/json"
        }
        if token:
            headers["Authorization"] = f"Bearer {token}"

        success_count = 0
        for _, row in df.iterrows():
            payload = self.create_payload(row)
            print(f"Uploading {payload['name']}...")
            
            try:
                resp = requests.post(target_url, json=payload, headers=headers)
                if resp.status_code in [200, 201]:
                    print(f"Success: {resp.json()}")
                    success_count += 1
                else:
                    print(f"Failed ({resp.status_code}): {resp.text}")
            except Exception as e:
                print(f"Request error: {e}")

        print(f"Uploaded {success_count}/{len(df)} people.")
        return df

    def create_payload(self, row):
        # Extract fields
        name = row.get("krs_name") or row.get("full_name") or "Unknown"
        
        # History content
        content = row.get("history", "")
        
        # Wikipedia
        wikipedia = ""
        if pd.notna(row.get("wiki_name")):
             wikipedia = f"https://pl.wikipedia.org/wiki/{row['wiki_name']}"
        
        # Rejestr.io logic could vary, but usually involves KRS
        rejestr_io = ""
        
        companies = []
        employment = row.get("employment")
        if isinstance(employment, list):
            for emp in employment:
                # Structure of emp: {'employed_krs': '...', 'employed_for': ..., 'employed_end': ...}
                # Check get_company_names or similar if available, but row might just have IDs
                # We need company name. PeopleEnriched calculates it but passed it to append_nice_history.
                # Does dataframe have company names directly?
                # row['employment'] items seem to be dicts.
                # If we don't have company name here, we might just use KRS as name temporarily or fetching it?
                # The 'history' text has company names.
                # Let's check if we can get company name.
                # 'PeopleEnriched' uses 'read_enriched' which calls 'get_company_names'.
                # But 'read_enriched' returns a dataframe with 'history' column, but doesn't seem to enrich the 'employment' structure itself with names?
                # Wait, 'append_nice_history' uses 'company_names'.
                # We might need to map KRS to name again if we want structured company data.
                # Or just use KRS as name if unknown.
                
                krs = emp.get("employed_krs", "")
                role = "Pracownik" # generic
                companies.append({
                    "name": krs, # Placeholder if name unknown
                    "krs": krs,
                    "role": role,
                    "end": emp.get("employed_end", "")
                })
        
        # Articles - usually not in this dataframe structure
        articles = []
        
        return {
            "name": name,
            "content": content,
            "wikipedia": wikipedia,
            "rejestrIo": rejestr_io,
            "companies": companies,
            "articles": articles
        }
