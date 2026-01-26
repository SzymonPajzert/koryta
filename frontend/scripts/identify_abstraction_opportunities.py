import os
import re

CYPRESS_DIR = "/Users/szymonpajzert/Programming/koryta/frontend/cypress/e2e"

patterns = {
    "Direct Visit": r"cy\.visit\(",
    "Direct Input Selection": r"cy\.get\(['\"]input",
    "Label Selection": r"cy\.contains\(['\"]label",
    "Submit Button": r"cy\.contains\(['\"]button['\"], ['\"]Zapisz",
    "Hidden Selectors": r"cy\.get\(.*\.v-overlay",
}

def analyze_files():
    results = {}
    total_opportunities = 0

    for root, _, files in os.walk(CYPRESS_DIR):
        for file in files:
            if file.endswith(".cy.ts"):
                path = os.path.join(root, file)
                rel_path = os.path.relpath(path, CYPRESS_DIR)
                with open(path, "r") as f:
                    content = f.read()
                    
                file_results = {}
                for name, pattern in patterns.items():
                    matches = len(re.findall(pattern, content))
                    if matches > 0:
                        file_results[name] = matches
                        total_opportunities += matches
                
                if file_results:
                    results[rel_path] = file_results

    print(f"Total Abstraction Opportunities Found: {total_opportunities}\n")
    print(f"{'File':<40} | {'Pattern':<25} | {'Count'}")
    print("-" * 80)
    
    for file, metrics in sorted(results.items(), key=lambda x: sum(x[1].values()), reverse=True):
        first = True
        for pattern, count in metrics.items():
            if first:
                print(f"{file:<40} | {pattern:<25} | {count}")
                first = False
            else:
                print(f"{'':<40} | {pattern:<25} | {count}")
        print("-" * 80)

if __name__ == "__main__":
    analyze_files()
