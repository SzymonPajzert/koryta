To run the scripts:

1. go to the data/scrapers directory
2. Make sure to set up flags to access local, staging or prod
    - TODO the code should check it for you
3. Call the command with module set, so the relative imports work:
```
python -m scripts.firestore_stats scripts/firestore_stats.py
```