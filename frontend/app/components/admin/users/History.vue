<template>
  <div class="uhist" data-history>
    <h3 class="urow-heading">Historia konta</h3>
    <p v-if="sorted.length === 0" class="text-body-2 text-medium-emphasis">
      Nikt jeszcze nic na tym koncie nie zmieniał.
    </p>
    <ol v-else class="uhist__list">
      <li
        v-for="entry in sorted"
        :key="entry.id"
        class="uhist__item"
        :data-history-kind="entry.kind"
      >
        <div>
          <strong>{{ userActionLabels[entry.kind] }}</strong>
          <span v-if="change(entry)" class="ms-1"> · {{ change(entry) }} </span>
        </div>
        <div class="text-caption text-medium-emphasis">
          {{ formatWhen(entry.at) }} · {{ actorLabel(entry) }}
        </div>
        <div v-if="entry.reason" class="uhist__reason">
          „{{ entry.reason }}”
        </div>
        <div v-if="entry.detail" class="text-caption">{{ entry.detail }}</div>
      </li>
    </ol>
  </div>
</template>

<script setup lang="ts">
/** Everything done to an account, from `userActions`: nominations and
 * withdrawals, what the script applied, requests and their answers, and
 * moderation - each with who, when and why.
 *
 * Newest first, whatever order it arrives in: the question the list answers is
 * usually "what happened last", and the server sorts in memory with no index
 * to promise an order by. */
import { computed } from "vue";
import { actorLabel, describeRoleChange } from "~/composables/adminUsers";
import { userActionLabels, type AdminUserDetail } from "~~/shared/userAdmin";

type Entry = AdminUserDetail["history"][number];

const props = defineProps<{ entries: Entry[] }>();

const sorted = computed(() =>
  [...props.entries].sort((a, b) => b.at.localeCompare(a.at)),
);

const change = (entry: Entry) => describeRoleChange(entry.from, entry.to);

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString("pl-PL", {
    dateStyle: "medium",
    timeStyle: "short",
  });
</script>

<style scoped>
.uhist__list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.uhist__item {
  padding: 6px 0 6px 12px;
  border-inline-start: 2px solid rgba(var(--v-border-color), 0.24);
  font-size: 0.875rem;
}

.uhist__item + .uhist__item {
  margin-top: 4px;
}

.uhist__reason {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
