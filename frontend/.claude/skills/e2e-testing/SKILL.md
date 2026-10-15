---
description: Best practices and patterns for E2E testing with Cypress in this project
---

# E2E Testing Guidelines

## Handling System Alerts

The application uses `window.alert` for success and error messages. Cypress automatically accepts alerts but does not show them. To verify a message, you must stub the alert.

```typescript
// Stub the alert
const alertStub = cy.stub().as("alertStub");
cy.on("window:alert", alertStub);

// Perform action that triggers the alert (e.g., clicking submit)
cy.get('[data-testid="submit-button"]').click();

// Verify the alert message
cy.get("@alertStub").should("have.been.calledWith", "Success Message!");
```

## Interacting with Entity Picker

The `EntityPicker` component is a custom Vuetify-based autocomplete.

```typescript
// Type to search
cy.get('[data-testid="entity-picker-input"] input').type("Search Term");

// Select an existing item from the dropdown
cy.contains(".v-list-item", "Search Term").click();

// To add a new item (if supported)
// cy.contains("Dodaj \"Search Term\" do bazy").click();
```

## Quick Add Buttons

Quick add buttons in `EntityDetailsCard` have dynamic labels based on the relationship type (defined in `useEdgeTypes.ts`).

```typescript
// Target specific button by text
cy.contains("button", "Dodaj osobę, którą Konkretna Osoba zna")
  .should("exist")
  .click();
```

## Viewport Management

Some UI elements might be hidden or collapsed on smaller screens. Explicitly set the viewport if interacting with desktop-only layouts or complex forms.

```typescript
cy.viewport(1280, 800);
```
