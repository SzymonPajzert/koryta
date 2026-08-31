---
description: The five surfaces that list a node's relations, and the rule that /eksploruj/nowe and /eksploruj/tabela stay in parity
---

# Surfaces that list a node's relations

A node's relations are drawn in five places. They look nothing alike, but they
are all "here is one node and what it is connected to", so a capability added to
one usually belongs on the others.

| Surface                      | Component                             | Host                                                   |
| ---------------------------- | ------------------------------------- | ------------------------------------------------------ |
| Person page                  | `card/EmploymentHistory.vue`          | `EntityDetailView.vue`                                 |
| Region page                  | `card/ConnectionList` + `ShortNode`   | `EntityDetailView.vue`                                 |
| Company page                 | `card/EmploymentHistory` + `ConnectionList` | `place/DetailView.vue`                           |
| `/eksploruj/nowe`            | `card/EmploymentHistory.vue`          | `pages/eksploruj/nowe.vue`                             |
| `/eksploruj/tabela`, `/admin/notatki` | `card/EmploymentHistory.vue` | `explore/NodeDrawer.vue`                               |

An **article** (`article/DetailView.vue`) and a **topic**
(`pages/temat/[slug].vue`) have views of their own and are deliberately not in
this list. What an article shows is a citation of somebody else's relation seen
from the side, so acting on the relation from there is the wrong place for it.

## /eksploruj/nowe and /eksploruj/tabela stay in parity

They are the same job in two shapes. `tabela` is the whole queue as a table with
a drawer for whichever row you click; `nowe` is that queue narrowed to one person
at a time with everything you need to judge them on the page. A reviewer moves
between them without re-learning anything, so:

**Whatever one can do to a person or their relations, the other should be able
to do too - in its own shape, not by copying the layout.** A control that lives
in the drawer on `tabela` may be an inline button on `nowe`; what must not differ
is whether the capability exists at all.

They are hosted differently, which is the trap: `tabela` and `/admin/notatki`
both go through `explore/NodeDrawer.vue`, so a change there covers two pages and
misses `nowe`, which renders the same card directly. Check both hosts.

## What a row can do, and who may do it

`card/EmploymentHistory.vue` takes one prop per capability rather than one
"editor" flag, because they are not the same permission and not every host
mounts the dialog behind them:

| Prop           | Control      | Who              | Where it goes                                     |
| -------------- | ------------ | ---------------- | ------------------------------------------------- |
| `can-add`      | „Dodaj”      | signed in        | `form/AddRelationDialog.vue` → `/api/edges/create` |
| `can-cite`     | sources      | signed in        | `form/EdgeSourcesDialog.vue`                       |
| `can-correct`  | pencil       | signed in        | `dialog/EditRelation.vue` → `/api/edges/update`     |
| `can-remove`   | bin          | **admin only**   | `dialog/RemoveEdge.vue` → `/api/edges/delete`       |

Only removal is an admin's alone. A correction from anybody else is written as a
pending revision and waits in /admin/rewizje-krawedzi; an admin's is applied as
it is written. `/api/edges/update` decides that, not the dialog - the dialog only
says which of the two is about to happen.

**A relation's ends and its type are not editable anywhere.** `edgeEditSchema`
leaves `source`, `target` and `type` off the allowlist on purpose: moving an end
turns a wrong claim into a different claim, and the honest version of that is a
removal and an addition, each with its own record. Both edit surfaces say so
above their fields; do not "fix" one by wiring the pickers up.

Pass `can-cite` only where the host actually renders `FormEdgeSourcesDialog` and
handles `@sources`. The drawer and `/eksploruj/nowe` do not, which is why they
pass `can-correct` alone - a button that emits into nothing is worse than no
button.

## Shared pieces

Do not paste the flow into a sixth place. `npm run check:duplication` reports
`.vue` clones at 0.00% and it is worth keeping there.

- `composables/edgeRemoval.ts` - `useEdgeRemoval({ subjectName, refresh })`
  returns everything the admin removal flow needs: `canRemove` (the admin
  check), the dialog state, and `openRemove` / `onEdgeRemoved` handlers.
- `components/dialog/RemoveEdgeHost.vue` - the dialog and its "usunięte" notice
  as one tag, bound to that state.
- `composables/edgeEditing.ts` - the same shape for corrections:
  `useEdgeEditing({ subjectName, refresh })` gives `canEdit`, `canApply`, the
  dialog state and `openEdit` / `onEdgeEdited`.
- `components/dialog/EditRelationHost.vue` - the correction dialog and its
  notice as one tag. The notice has two wordings, because a contributor's edit
  went to a queue and an admin's did not.
- `components/form/RelationDetailFields.vue` - the fields a relation is
  described by (role, dates, party, committee), shared by the add and the
  correct dialogs so the same claim is typed the same way twice.
- `utils/edgeSentence.ts` - one relation read as a sentence, for any dialog that
  is handed an edge id and has to tell the reader which row they clicked.
- `utils/relationDate.ts` - the date rule both dialogs enforce, matching
  `relationDate` in `shared/api.ts`, which is what the server enforces.

The surface passes the `can-*` props and the matching handlers down to the card,
and gives `useEdgeRemoval` / `useEdgeEditing` a `refresh` that re-reads whatever
it fetched - a component that does not own the fetch (the drawer) emits
`changed` instead, and its host refreshes.
