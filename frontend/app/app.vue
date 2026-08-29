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

/* The site's card: a white surface, a hairline, and a hover that says it is a
   thing rather than a paragraph. Sage is a fill and a border here and never
   ink - `text-primary` on this theme is 1.85:1. */
.k-card {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), 0.16);
  border-radius: 10px;
  /* For the one card whose header carries a tint - the batch strip on a
     company page. Without it that strip squares off the top corners; the
     alternative is rounding the header separately wherever one exists. */
  overflow: hidden;
  position: relative;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.k-card:hover {
  border-color: rgba(var(--v-theme-primary), 0.9);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.07);
}

/* The sage edge, opt-in: a card that carries a claim about somebody - a
   handover, a board seat, a note a reader signed - takes it, and `k-note`
   never does. Inset top and bottom so it reads as a marker on the card rather
   than as a fourth border. */
.k-card--accent::before {
  background: rgb(var(--v-theme-primary));
  border-radius: 99px;
  bottom: 11px;
  content: "";
  left: 0;
  position: absolute;
  top: 11px;
  width: 3px;
}

/* Not a card: something the section says about itself - what it could not find
   or what it is withholding. Dashed, so it cannot be mistaken for a record. */
.k-note {
  background: rgb(var(--v-theme-surface));
  border: 1px dashed rgba(var(--v-border-color), 0.3);
  border-radius: 8px;
  padding: 12px 16px;
}

.k-note + .k-note {
  margin-top: 12px;
}

/* `flex-wrap` for the company page, whose headings carry a caption beside them
   that has to be allowed to drop to its own line on a phone. */
.sec-head {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.sec-head__icon {
  color: rgba(var(--v-theme-on-surface), 0.38);
}

.k-lead {
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.75rem;
  line-height: 1.5;
  margin: 4px 0 12px;
  max-width: 78ch;
}
</style>
