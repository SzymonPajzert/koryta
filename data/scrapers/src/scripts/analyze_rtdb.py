
import json
import collections
from pathlib import Path

def analyze_rtdb_structure(file_path):
    """
    Analyzes the structure of a Firebase RTDB export JSON file.
    Counts occurrences of each field, normalizing Firebase IDs (start with -) to <key>.
    """
    print(f"Loading {file_path}...")
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"Error: File not found at {file_path}")
        return

    field_counts = collections.Counter()
    
    def traverse(obj, path=""):
        if isinstance(obj, dict):
            for key, value in obj.items():
                # Normalize key if it looks like a Firebase ID
                normalized_key = "<key>" if key.startswith("-") else key
                
                # Heuristic: if parent path is 'user', the key is likely a UID. 
                if path.endswith("user") or path == "user":
                     normalized_key = "<uid>"
                
                # Heuristic: numeric keys
                if key.isdigit():
                    normalized_key = "<id>"

                current_path = f"{path}.{normalized_key}" if path else normalized_key
                field_counts[current_path] += 1
                
                traverse(value, current_path)
        elif isinstance(obj, list):
            for i, item in enumerate(obj):
                current_path = f"{path}.<index>"
                field_counts[current_path] += 1
                traverse(item, current_path)

    print("Analyzing structure...")
    traverse(data)

    print("\nField Analysis Results (Count Descending):")
    print(f"{'Count':<10} {'Field Path'}")
    print("-" * 60)
    
    for path, count in field_counts.most_common(100):  # Top 100
        print(f"{count:<10} {path}")

    print("\nPotentially Interesting Fields (containing 'comment', 'vote', 'text', 'score', 'suggestion'):")
    print(f"{'Count':<10} {'Field Path'}")
    print("-" * 60)
    interesting_keywords = ['comment', 'vote', 'text', 'score', 'suggestion', 'note']
    
    sorted_fields = sorted(field_counts.items(), key=lambda x: x[1], reverse=True)
    for path, count in sorted_fields:
        if any(keyword in path.lower() for keyword in interesting_keywords):
             print(f"{count:<10} {path}")

if __name__ == "__main__":
    base_path = Path(".")
    file_path = base_path / "downloaded/koryta-pl-default-rtdb-export.json"
    analyze_rtdb_structure(file_path)
