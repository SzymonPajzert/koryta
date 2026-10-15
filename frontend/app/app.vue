<template>
  <v-app>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </v-app>
</template>

<style scoped></style>

<style>
html {
  scroll-behavior: smooth;
}

/* Vuetify tints disabled filled buttons by laying a dark overlay over the
   button colour, which turns our sage primary into an unreadable olive.
   Use a neutral grey container + label instead. */
.v-btn--disabled.v-btn--variant-elevated,
.v-btn--disabled.v-btn--variant-flat {
  background: rgba(var(--v-theme-on-surface), 0.12) !important;
  color: rgba(var(--v-theme-on-surface), 0.5) !important;
}

.v-btn--disabled.v-btn--variant-elevated .v-btn__overlay,
.v-btn--disabled.v-btn--variant-flat .v-btn__overlay {
  opacity: 0;
}

/* Vuetify draws a field's label as a `.v-label`, at
   `--v-medium-emphasis-opacity` - 0.6 in the light theme - over the
   rgba(0, 0, 0, 0.87) the app inherits from `.v-application`. That composites
   to #7a7a7a on white, 4.29:1, under the 4.5:1 AA asks for; and the floating
   copy, the one an outlined field shows once it holds a value and the only
   thing then naming the control, is 0.75em - 12px. The palette's neutral ink
   at full opacity measures 6.50:1.

   Global rather than per-page: the label is a Vuetify default, so every form
   on the site carries it. Three classes deep, which leaves Vuetify's own
   four-class `.v-field--error:not(.v-field--disabled) .v-label.v-field-label`
   ahead of it, so an invalid field still labels itself in red. */
.v-field .v-label.v-field-label {
  opacity: 1;
  color: rgb(var(--v-theme-ink-neutral));
}

/* A link that is the row rather than a call to action - an entry name in a
   list, where every row carries one and the browser default turns the whole
   column blue. Reads as body text, underlines only when it is actually being
   pointed at, so the affordance survives without the colour.

   Global because the profile card and the review queue render the same
   proposal and must not drift apart; `.zrodla-link` and `.contributors__link`
   are older, scoped copies of these exact rules. */
.link-plain,
.link-plain:visited {
  color: inherit;
  text-decoration: none;
}

.link-plain:hover,
.link-plain:focus-visible {
  text-decoration: underline;
}

/* ---- the section shell an entity page is made of ----

   A heading (`sec-head`), a sentence under it (`k-lead`), and a stack of cards
   (`k-card`). `PageSection.vue` renders the first two; the third is here
   because the entries in a section are drawn by a *different* component than
   the section itself, so a scoped rule can never reach them. That is the
   mechanical reason five components ended up hand-copying this block - and the
   copies drifted: `k-card` was 10px round in `succession/PersonChanges.vue`
   and 8px in `succession/CompanyChanges.vue`, its sage rail 3px inset in one
   and 4px full-height in the other, `sec-head` centred with an 8px gap in
   four components and baseline-aligned with a 10px one in the fifth, and the
   notes had no card at all - they were a read-only form. A reader reported the
   result twice ("notatki odstają od reszty strony osoby"), which is what a
   fifth copy buys. There is one rule now; a component that needs something
   else says so in a class of its own rather than redefining these. */

/* The site's card: a white surface, the one hairline (assets/css/edges.css),
   and a hover that says it is a thing rather than a paragraph. Sage is a fill
   and a border here and never ink - `text-primary` on this theme is 1.85:1. */
.k-card {
  background: rgb(var(--v-theme-surface));
  border: 1px solid var(--k-line);
  border-radius: var(--k-r-card);
  /* For the one card whose header carries a tint - the batch strip on a
     company page. Without it that strip squares off the top corners; the
     alternative is rounding the header separately wherever one exists. */
  overflow: hidden;
  position: relative;
  transition: border-color 0.2s ease;
}

/* The sage edge on hover, and no lift: a shadow is for what floats. */
.k-card:hover {
  border-color: rgba(var(--v-theme-primary), 0.9);
}

/* The sage edge, opt-in: a card that carries a claim about somebody - a
   handover, a board seat, a note a reader signed - takes it, and `k-note`
   never does. Flush and full height, clipped by the card's radius, the way
   the home feed's cards draw theirs: one rail drawn one way. It used to be
   inset 11px top and bottom, which beside the card's own hairline read as a
   second line. */
.k-card--accent::before {
  background: rgb(var(--v-theme-primary));
  bottom: 0;
  content: "";
  left: 0;
  position: absolute;
  top: 0;
  width: 4px;
}

/* Not a card: something the section says about itself - what it could not find
   or what it is withholding. No edge and no fill, so it cannot be mistaken for
   a record: the icon and the muted line say it. */
.k-note {
  padding: 4px 0;
}

.k-note + .k-note {
  margin-top: 4px;
}

/* `flex-wrap` for the company page, whose headings carry a caption beside them
   that has to be allowed to drop to its own line on a phone. On the baseline,
   so that 12px caption sits on the 24px heading's line rather than floating
   in the middle of it. */
.sec-head {
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.sec-head__icon {
  color: rgba(var(--v-theme-on-surface), 0.38);
}

/* A count beside a section's heading: single-line meta, 12px in the quiet
   ink. Sentence case and no tracking - it is a fact about the section, not a
   label over it. */
.sec-head__caption {
  color: rgba(var(--v-theme-on-surface), var(--k-quiet-ink));
  font-size: var(--k-meta-size);
  line-height: 1.4;
}

/* On a phone the caption takes a line of its own, tight under the head:
   beside a 20px head it landed on the head's line or under it depending on
   its length. */
@media (max-width: 599.98px) {
  .sec-head {
    row-gap: 2px;
  }

  .sec-head__caption {
    flex-basis: 100%;
  }
}

/* A group head: what splits one list into parts - „Obecnie” and
   „Zakończone” over a person's history, „Potwierdzone przez czytelników” over
   their facts. The type system's group-head role, 14/600 in the quiet ink and
   sentence case, under the section's 24px head. Spacing is the list's. */
.k-group-head {
  color: rgba(var(--v-theme-on-surface), var(--k-quiet-ink));
  font-size: var(--k-ui-size);
  font-weight: 600;
  line-height: 1.4;
}

/* 14px, the UI size: prose is never 12px on this site. 12 is for single-line
   meta - dates, counts, chips, labels. */
.k-lead {
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.875rem;
  line-height: 1.5;
  margin: 4px 0 12px;
  max-width: 78ch;
}
</style>
