<template>
  <!-- A region's „Władze”: the head, and each council by who would join and
       who would leave it; the rest folded under a count. -->
  <div
    v-if="compared?.kind === 'government'"
    class="compared"
    data-testid="compared-government"
  >
    <div v-if="compared.head" class="compared__part">
      <div class="compared__title">{{ compared.head.office }}</div>
      <div v-if="compared.head.was !== undefined" class="compared__removed">
        <span class="d-sr-only">było: </span
        >{{ compared.head.was ?? "brak danych" }}
      </div>
      <div
        :class="{ compared__added: compared.head.was !== undefined }"
        data-testid="compared-head"
      >
        {{ compared.head.text ?? "brak danych" }}
      </div>
    </div>
    <div
      v-for="council in compared.councils"
      :key="council.office"
      class="compared__part"
      :data-testid="`compared-council-${council.office}`"
    >
      <div class="compared__title">
        {{ council.office }} ({{ council.count }})
      </div>
      <div
        v-for="name in council.added"
        :key="`+${name}`"
        class="compared__added"
      >
        <span aria-hidden="true">+ </span
        ><span class="d-sr-only">dochodzi: </span>{{ name }}
      </div>
      <div
        v-for="name in council.removed"
        :key="`-${name}`"
        class="compared__removed"
      >
        <span aria-hidden="true">− </span
        ><span class="d-sr-only">odchodzi: </span>{{ name }}
      </div>
      <template v-if="council.kept.length">
        <button
          type="button"
          class="compared__toggle"
          :aria-expanded="open.has(council.office)"
          @click="toggle(council.office)"
        >
          {{
            polishCounting(council.kept.length, "osoba", "osoby", "osób") +
            (council.added.length || council.removed.length ? " bez zmian" : "")
          }}
          <v-icon
            :icon="open.has(council.office) ? mdiChevronUp : mdiChevronDown"
            size="small"
          />
        </button>
        <div v-if="open.has(council.office)" class="compared__kept">
          <div v-for="name in council.kept" :key="name">{{ name }}</div>
        </div>
      </template>
    </div>
  </div>

  <!-- A list: an item a line, what the approved version lacks marked as
       added and what it has crossed out. -->
  <div
    v-else-if="compared?.kind === 'list' && compared.items.length"
    class="compared"
    data-testid="compared-list"
  >
    <div
      v-for="item in compared.items"
      :key="`${item.change ?? ''}${item.text}`"
      :class="{
        compared__added: item.change === 'added',
        compared__removed: item.change === 'removed',
      }"
    >
      <template v-if="item.change === 'added'"
        ><span aria-hidden="true">+ </span
        ><span class="d-sr-only">dodano: </span></template
      ><template v-else-if="item.change === 'removed'"
        ><span aria-hidden="true">− </span
        ><span class="d-sr-only">usunięto: </span></template
      >{{ item.text }}
    </div>
  </div>

  <pre v-else-if="text" class="mb-0">{{ text }}</pre>
  <span v-else class="text-medium-emphasis font-italic">- brak -</span>
</template>

<script setup lang="ts">
import { mdiChevronDown, mdiChevronUp } from "@mdi/js";
import { polishCounting } from "~/composables/polish";
import { compareFieldValue } from "~~/shared/revisionChanges";

/** A field's value in a column of `/admin/rewizje/[id]`'s side-by-side
 * table. A list reads an item a line and a region's „Władze” by part, each
 * against the approved version, so what a revision changes stands out of
 * the sixty names it repeats. Szymon, board round region-lists-r3: "This is
 * hard to read - we should have special cases to compare list fields". */
const props = defineProps<{
  /** The value as the revision stores it. */
  value: unknown;
  /** The approved version's value of the field; undefined in the approved
   * column itself, and where nothing is approved yet. */
  approved?: unknown;
  /** The value as one line, for whatever is not a list. */
  text: string | null;
}>();

const compared = computed(() => compareFieldValue(props.value, props.approved));

const open = ref(new Set<string>());
function toggle(office: string) {
  const next = new Set(open.value);
  if (next.has(office)) next.delete(office);
  else next.add(office);
  open.value = next;
}
</script>

<style scoped>
.compared {
  display: flex;
  flex-direction: column;
  gap: 2px;
  white-space: normal;
}

.compared__part + .compared__part {
  margin-top: 8px;
}

.compared__title {
  font-weight: 600;
}

/* As the diff above the table draws a change (revision/Diff.vue): what goes
   crossed out and faded, what comes in at a heavier weight. */
.compared__removed {
  opacity: 0.6;
  text-decoration: line-through;
}

.compared__added {
  font-weight: 500;
}

.compared__toggle {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), var(--k-quiet-ink));
  display: inline-flex;
  gap: 2px;
  text-align: left;
}

.compared__toggle:focus-visible {
  outline: 2px solid rgb(var(--v-theme-ink-neutral));
  outline-offset: 2px;
}

.compared__kept {
  color: rgba(var(--v-theme-on-surface), var(--k-quiet-ink));
}
</style>
