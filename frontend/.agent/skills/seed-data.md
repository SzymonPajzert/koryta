---
description: Information about seed data and test credentials for the emulator
---

# Seed Data & Credentials

When running with the emulator (`npm run dev:local`), the database is seeded with test data from `scripts/seed-emulator.ts`.

## Test Users

| Role      | Email             | Password      |
| --------- | ----------------- | ------------- |
| **Admin** | `admin@koryta.pl` | `password123` |
| **User**  | `user@koryta.pl`  | `password123` |

## Data Sources

Seed data is loaded from JSON files in the `scripts/` directory:

- `scripts/nodes.json`: Initial nodes (People, Companies, etc.)
- `scripts/edges.json`: Initial relationships
- `scripts/revisions.json`: Revision history
- `scripts/extractions.json`: Facts from articles. Anna Nowak (3) has two,
  Krzysztof Wójcik (5) one - a relation naming Żaneta Wspomniana, who has no
  node. Two match nobody: one names Jan Kowalski, who has a node, the other
  Łukasz Nieprzypisany, who has not. The two without a node are what
  `/api/search/facts` finds (`tests/e2e/omni_search_facts.spec.ts`).

## Running Seeds manually

You can re-run the seed script manually if needed:

```bash
npx tsx scripts/seed-emulator.ts
```

To clear the database without seeding:

```bash
npx tsx scripts/seed-emulator.ts --empty
```
