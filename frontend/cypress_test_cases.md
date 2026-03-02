# Cypress Test Cases

This document outlines all test cases grouped by their respective files.

## `e2e/entity_management/local_graph.cy.ts`

- shows local graph with current node and neighbors

## `e2e/entity_management/person_wiki.cy.ts`

- should create a new person with a Wikipedia link and display it

## `e2e/_implementations/comments.ts`

- allows posting a comment on an entity page
- allows replying to a comment
- allows posting a lead in leads page and replying to it

## `e2e/_implementations/toolbar_workflow.ts`

- shows toolbar only when logged in
- pre-selects Article type when clicking Dodaj artykuł
- pre-selects Person type when clicking Dodaj osobę
- shows revisions list

## `e2e/_implementations/entity_picker_workflow.ts`

- should list unapproved nodes when logged in
- should create new entity inline and select it

## `e2e/_implementations/revisions_lifecycle.ts`

- lists pending edge revisions (newly created edges) and resolves names
- should display pending revisions and allow navigation to details

## `e2e/_implementations/edit_connections.ts`

- allows adding and removing a connection
- updates the entity picker when switching relationship types

## `e2e/_implementations/entity_auth_redirect.ts`

- Redirects to login when clicking 'Zaproponuj zmianę' while logged out
- Redirects to login when clicking 'Zaproponuj usunięcie' while logged out
- Redirects to login when clicking 'Dodaj artykuł' while logged out

## `e2e/_implementations/article_entities.ts`

- should display article entity page
- should allow adding an edge from an article page
- should allow adding an edge with article reference from person page

## `e2e/_implementations/edit_entity.ts`

- allows creating and editing an entity
- should prepopulate fields when editing an existing entity

## `e2e/_implementations/audit_workflow.ts`

- should navigate to Audit page and show correct data in tabs
- should show correct data on Audit page

## `e2e/_implementations/region_parent_edge.ts`

- should open region parent form and indicate searching for object/region
- should allow creating a new region and adding it as parent

## `e2e/_implementations/entity_page.ts`

- Displays content for Person 1 (Jan Kowalski / Politician from PO)
- Displays connected entities with names
- Navigates to connected entity page when link is clicked

## `e2e/_implementations/person_details.ts`

- should allow adding birth date and external links when creating a person

## `e2e/_implementations/pomoc.ts`

- screenshots

## `e2e/_implementations/already_existing.ts`

- shows suggestions for similar names and navigates to existing page

## `e2e/_implementations/zrodla.ts`

- screenshots

## `e2e/_implementations/omni_search.ts`

- allows searching for parties
- should filter out regions and companies without people in OmniSearch
- should show valid chain of connected entities in OmniSearch
- should dedup companies
- navigates to entity page when clicking a company result
- navigates to list view when clicking 'Lista' button on entity page
- navigates to graph view when clicking 'Graf' button on entity page

## `e2e/_implementations/graph.ts`

- normally doesn't see a dialog
- should filter out empty regions and companies in the Graph view
- should show valid chain of connected entities in the Graph view

## `e2e/_implementations/revisions.ts`

- shows correct number of people
- Displays approved revision for anonymous user
- Displays latest revision for logged in user

## `e2e/_implementations/new_node_navigation.ts`

- navigates to the new node edit page after creation
- allows creating a node without content and verifies it is searchable

## `e2e/_implementations/home.ts`

\_(Skip it, attempting it in another commit)\_\_

- displays four clickable cards
- displays dashboard
- shows list when clicking the first card - chart
- shows correct number of people
- shows pomoc when clicking the card with 'Dodaj osoby'

## `e2e/_implementations/list.ts`

- screenshots

## `e2e/_implementations/my_revisions.ts`

- should allow reverting a proposed revision

## `e2e/_implementations/friction_flow.ts`

- should allow a logged-in user to create a person and a company, then link them
  _(Note: Not migrating to Vitest as this is an End-to-End integration test covering multiple pages, forms, and search functionality which is unsuited for unit testing)_

## `e2e/_implementations/api/bulk_create.ts`

- creates a person with companies

## `e2e/_implementations/api/edge_revisions.ts`

- creates an edge with revision
