
import pandas as pd
import json

try:
    df = pd.read_json("versioned/people_merged.jsonl", lines=True)
    # Search for Adam Smoter in krs_name or pkw_name
    mask = df["krs_name"].str.contains("Adam Smoter", case=False, na=False) | \
           df["pkw_name"].str.contains("Adam Smoter", case=False, na=False)
    
    records = df[mask]
    if not records.empty:
        print(f"Found {len(records)} records for Adam Smoter:")
        # Print relevant columns to understand why they didn't merge
        print(records[["krs_name", "pkw_name", "birth_year", "metaphone", "first_name", "last_name", "second_name"]].to_string())
        
        # Check duplicates logic
        dupes = records[records.duplicated(subset=["krs_name"], keep=False)]
        if not dupes.empty:
            print("\nHe is a duplicate based on krs_name.")
    else:
        print("Adam Smoter not found in people_merged.jsonl")

except Exception as e:
    print(f"Error: {e}")
