
import pandas as pd

try:
    df = pd.read_json("versioned/people_merged.jsonl", lines=True)
    records = df[df["krs_name"] == "Paweł Nowak"]
    if not records.empty:
        print(f"Found {len(records)} records for Paweł Nowak:")
        print(records[["krs_name", "birth_year", "first_name", "last_name", "second_name", "rejestrio_id"]].to_string())
        
        birth_years = records["birth_year"].dropna().unique()
        print(f"Birth years: {birth_years}")
        if len(birth_years) > 1:
            birth_years = sorted(birth_years)
            min_diff = min(b - a for a, b in zip(birth_years, birth_years[1:]))
            print(f"Min diff: {min_diff}")
    else:
        print("Paweł Nowak not found")

except Exception as e:
    print(f"Error: {e}")
