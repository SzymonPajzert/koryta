
import pandas as pd
import json

try:
    df = pd.read_json("versioned/people_merged.jsonl", lines=True)
    # Search for Teresa Zięba in krs_name or pkw_name
    mask = df["krs_name"].str.contains("Teresa Zięba", case=False, na=False) | \
           df["pkw_name"].str.contains("Teresa Zięba", case=False, na=False)
    
    records = df[mask]
    if not records.empty:
        print(f"Found {len(records)} records for Teresa Zięba:")
        print(records[["krs_name", "pkw_name", "birth_year", "elections"]].to_string())
        
        # Check duplicates logic
        dupes = records[records.duplicated(subset=["krs_name"], keep=False)]
        if not dupes.empty:
            print("\nShe is a duplicate based on krs_name.")
    else:
        print("Teresa Zięba not found in people_merged.jsonl")

except Exception as e:
    print(f"Error: {e}")
