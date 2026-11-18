<template>
  <!-- The people on one election list, a row each: the name, what they stood
       for, their parties and whether they won the seat - „Wybrany/a”, as
       every page says a win: nothing stores anybody's grammatical gender
       (shared/activityFeed.ts), and Szymon chose the slash over another
       wording (2026-11-18). -->
  <ul
    class="list-members"
    :class="{
      'list-members--indent': indent,
      'list-members--columns': columns,
    }"
    data-testid="list-members"
  >
    <li
      v-for="(member, index) in members"
      :key="member.personId || `bez-strony-${index}`"
      class="list-member"
      :class="{
        'list-member--self': member.personId && member.personId === highlightId,
      }"
      :aria-current="
        member.personId && member.personId === highlightId ? 'true' : undefined
      "
      :data-testid="`list-member-${member.personId || `bez-strony-${index}`}`"
    >
      <!-- `nofollow` to a page nobody has published: for a logged out
           reader, and so for a crawler, it is the teaser, which answers
           404. As on a company's board. -->
      <NuxtLink
        v-if="member.personId"
        :to="generateEntityUrl('person', member.personId, member.personName)"
        :rel="member.published ? undefined : 'nofollow'"
        class="link-plain list-member__name"
        >{{ member.personName }}</NuxtLink
      >
      <!-- A councillor with no page, or none this reader may open: the name
           PKW gives, as text (Szymon, 2026-11-18: "they should just be
           listed for the information"). -->
      <span v-else class="list-member__name">{{ member.personName }}</span>
      <span
        v-if="!plain && member.offices.length"
        class="text-caption font-weight-bold list-member__office"
      >
        {{ member.offices.join(", ") }}
      </span>
      <PartyChip v-for="party in member.parties" :key="party" :party />
      <!-- The party of an unpublished candidate, which a logged out reader
           is told is there and not what it is. -->
      <ChipHiddenParty v-if="member.partyHidden" />
      <v-chip
        v-if="!plain && member.elected"
        size="x-small"
        color="success"
        variant="flat"
      >
        Wybrany/a
      </v-chip>
    </li>
  </ul>
</template>

<script setup lang="ts">
import { generateEntityUrl } from "~~/shared/slugs";
import type { ListMember } from "~~/shared/electionLists";

defineProps<{
  /** A member with an empty `personId` has no page this reader may open:
   * the name is text. */
  members: ListMember[];
  /** The person the reader came from, whose row the list marks. */
  highlightId?: string;
  /** A step in from the left, for a list opened under its own head. */
  indent?: boolean;
  /** Two names to a row on a desktop: a council's committee in its tab. */
  columns?: boolean;
  /** Without the offices and the „Wybrany/a” chip: for a council's members,
   * where every row would say the same of both. */
  plain?: boolean;
}>();
</script>

<style scoped>
.list-members {
  list-style: none;
  margin: 0;
  padding: 0;
}

/* A name and its chips on one line where they fit, wrapping under the name
   where they do not: a registry name runs long, a candidate's rarely, but
   the office list can. */
.list-member {
  align-items: center;
  column-gap: 8px;
  display: flex;
  flex-wrap: wrap;
  padding: 10px 16px;
  position: relative;
  row-gap: 4px;
}

.list-members--indent .list-member {
  padding-left: 32px;
}

.list-member + .list-member {
  border-top: 1px solid var(--k-line);
}

.list-member__name {
  font-size: var(--k-ui-size);
  font-weight: 600;
}

/* Two to a row on a desktop, the rules between them as between rows: every
   row ruled above but the first two, and the right-hand one ruled off from
   the left. */
@media (min-width: 960px) {
  .list-members--columns {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .list-members--columns .list-member {
    border-top: 1px solid var(--k-line);
  }

  .list-members--columns .list-member:nth-child(-n + 2) {
    border-top: 0;
  }

  .list-members--columns .list-member:nth-child(2n) {
    border-left: 1px solid var(--k-line);
  }
}

/* The person the reader came from: a rail on their own row, so among the
   others on the list they are the one already met. In ink, not the sage of
   a card's accent edge: here the rail is the one thing that tells the row
   apart, a thin indicator, and those take the ink tokens (system.md,
   2026-10-14). */
.list-member--self::before {
  background: rgb(var(--v-theme-ink-sage));
  bottom: 0;
  content: "";
  left: 0;
  position: absolute;
  top: 0;
  width: 4px;
}
</style>
