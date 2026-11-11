<template>
  <!-- The people on one election list, a row each: the name, what they stood
       for, their parties and whether they won the seat - the words a
       person's own run row uses (card/EmploymentHistory.vue), so the two
       read alike. -->
  <ul
    class="list-members"
    :class="{ 'list-members--indent': indent }"
    data-testid="list-members"
  >
    <li
      v-for="member in members"
      :key="member.personId"
      class="list-member"
      :class="{ 'list-member--self': member.personId === highlightId }"
      :aria-current="member.personId === highlightId ? 'true' : undefined"
      :data-testid="`list-member-${member.personId}`"
    >
      <!-- `nofollow` to a page nobody has published: for a logged out
           reader, and so for a crawler, it is the teaser, which answers
           404. As on a company's board. -->
      <NuxtLink
        :to="generateEntityUrl('person', member.personId, member.personName)"
        :rel="member.published ? undefined : 'nofollow'"
        class="link-plain list-member__name"
        >{{ member.personName }}</NuxtLink
      >
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
        Wybrany
      </v-chip>
    </li>
  </ul>
</template>

<script setup lang="ts">
import { generateEntityUrl } from "~~/shared/slugs";
import type { ListMember } from "~~/shared/electionLists";

defineProps<{
  members: ListMember[];
  /** The person the reader came from, whose row the list marks. */
  highlightId?: string;
  /** A step in from the left, for a list opened under its own head. */
  indent?: boolean;
  /** Without the offices and the „Wybrany” chip: for a council's members,
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

/* The person the reader came from: the sage edge a card carrying a claim
   about somebody takes (`k-card--accent`, app.vue), on their own row - so
   among the others on the list, they are the one already met. */
.list-member--self::before {
  background: rgb(var(--v-theme-primary));
  bottom: 0;
  content: "";
  left: 0;
  position: absolute;
  top: 0;
  width: 4px;
}
</style>
