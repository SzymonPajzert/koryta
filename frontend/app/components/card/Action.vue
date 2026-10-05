<template>
  <v-card
    :to="to"
    :href="href"
    :target="opensInNewTab ? '_blank' : undefined"
    :rel="opensInNewTab ? 'noopener' : undefined"
    :role="isButton ? 'button' : undefined"
    :tabindex="isButton ? 0 : undefined"
    height="100%"
    variant="outlined"
    rounded="lg"
    hover
    @click="isButton && emit('activate')"
    @keydown="onKeydown"
  >
    <v-card-item>
      <template #prepend>
        <v-icon :icon="icon" size="large" :color="ink" />
      </template>
      <template v-if="access" #append>
        <!-- One neutral style for all three values, so the chip reads as a fact
             about the door rather than as a status - „po zalogowaniu” is not a
             warning and „bez konta” is not a reward. -->
        <v-chip size="x-small" variant="tonal" color="ink-neutral" label>
          {{ accessLabels[access] }}
        </v-chip>
      </template>
      <v-card-title class="text-wrap text-subtitle-1 font-weight-bold">
        {{ title }}
      </v-card-title>
    </v-card-item>
    <v-card-text class="text-body-2 text-medium-emphasis">
      <slot>{{ desc }}</slot>
    </v-card-text>
  </v-card>
</template>

<script lang="ts" setup>
import { computed } from "vue";

/** One door on the help page: an icon, a name, one sentence, and what it costs
 * the reader to open it.
 *
 * This markup existed four times byte-identically - three times in `pomoc.vue`
 * and once in `admin/index.vue` - and the copies had already drifted on which
 * of them tracked a click. What is new here is `access`: a list of ways to help
 * is worth nothing if half of them turn out to need an account the reader does
 * not have, and /pomoc used to promise „nie potrzebujesz konta” directly above
 * two pages that both carry `middleware: "auth"`.
 *
 * A card with neither `to` nor `href` is a button - it opens a dialog. Vuetify
 * only makes a `v-card` focusable when it is a link, so the role, the tabindex
 * and the keyboard handlers are set here rather than left to it.
 */
const props = defineProps<{
  title: string;
  /** One sentence. Use the default slot where it needs interpolation. */
  desc?: string;
  /** An mdi *path* - this app renders icons as svg paths, not class names. */
  icon: string;
  to?: string;
  href?: string;
  /** The band's ink token, e.g. „ink-info”. Carries the section's identity down
   * to the card, which is what survives when the heading scrolls away. */
  ink?: string;
  /** What it costs to open this door. Omitted only where the answer is
   * obvious from the card itself. */
  access?: "none" | "login" | "team";
}>();

const emit = defineEmits<{ activate: [] }>();

const accessLabels: Record<"none" | "login" | "team", string> = {
  none: "bez konta",
  login: "po zalogowaniu",
  team: "dla zespołu",
};

const ink = computed(() => props.ink ?? "ink-neutral");
const isButton = computed(() => !props.to && !props.href);

// A `mailto:` is handed to the mail client, and a browser asked to open one in
// a new tab can leave an empty tab behind over the page the reader was on.
const opensInNewTab = computed(() => props.href?.startsWith("http") ?? false);

/** Enter and Space, but only on the cards that are buttons.
 *
 * Not `@keydown.enter.prevent="isButton && …"`: Vue compiles that to
 * `withModifiers(fn, ["prevent"])`, which calls `preventDefault()` *before* it
 * evaluates the expression. The guard would have suppressed the emit and not
 * the preventDefault, so Enter and Space would have been swallowed on every
 * card that is a link - which is most of them - leaving a keyboard reader able
 * to focus „Przejrzyj kod na GitHubie” and unable to open it.
 */
const onKeydown = (event: KeyboardEvent) => {
  if (!isButton.value) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  emit("activate");
};
</script>
