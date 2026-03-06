---
description: Domain knowledge about Revisions, Edges, and the Audit system
---

# Revisions and Audit System

## Revisions Structure

Revisions track changes to nodes and edges. They are stored in Firestore.

- **Node Revisions**: Changes to properties of a Person, Company, Article, etc.
- **Edge Revisions**: Creation or modification of relationships between nodes.

## Edges

Edges connect two nodes (Source -> Target).

- **Storage**: Edges are stored as separate documents or within subcollections depending on the architecture version.
- **Display**: When displaying an edge revision, it is critical to show the names of both the Source and Target nodes.
  - The API (`/api/revisions/user/...`) is responsible for fetching these names.
  - An edge revision purely containing IDs is insufficient for the UI; it appears as "Obiekt" or "Bez nazwy".

## Edge Types

Edge types and their configuration are defined in `app/composables/useEdgeTypes.ts`.
This configuration controls:

- **Labels**: How the relationship is described (e.g., "Zatrudniony w").
- **Audit/Quick Add Buttons**: The text on buttons used to create these edges.
- **Directions**: Allowable directions (incoming/outgoing) for the relationship.

## Audit View

The `AuditView.vue` component displays a list of revisions.

- It relies on `useEdgeTypes` to format the description of what changed.
- For pending revisions or user history ("Moje Propozycje"), it fetches data from `/api/revisions/user/[id]`.
