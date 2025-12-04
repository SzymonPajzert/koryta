
import pandas as pd
import json

try:
    df = pd.read_json("versioned/person_pkw.jsonl", lines=True)
    # Search for Adam Smoter in pkw_name
    mask = df["pkw_name"].str.contains("Smoter Adam", case=False, na=False)
    
    records = df[mask]
    if not records.empty:
        print(f"Found {len(records)} records for Adam Smoter in PKW:")
        print(records[["pkw_name", "first_name", "last_name", "birth_year"]].to_string())
    else:
        print("Adam Smoter not found in person_pkw.jsonl")

except Exception as e:
    print(f"Error: {e}")
