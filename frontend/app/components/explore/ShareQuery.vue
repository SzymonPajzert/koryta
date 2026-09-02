<template>
  <v-tooltip text="Udostępnij ten widok" location="bottom">
    <template #activator="{ props: tooltipProps }">
      <!-- The tooltip only sets `aria-describedby`, so an icon-only button
           still reaches a screen reader as „przycisk”. The label is spelled
           out here rather than left to the tooltip, and `$attrs` is spread
           last so a parent that passes its own one wins. -->
      <v-btn
        v-bind="{ ...tooltipProps, ...$attrs }"
        :icon="mdiShareVariant"
        variant="text"
        size="small"
        aria-label="Udostępnij ten widok"
        @click="open = true"
      />
    </template>
  </v-tooltip>

  <v-dialog v-model="open" max-width="560">
    <v-card>
      <v-card-title class="d-flex align-center ga-2">
        <v-icon :icon="mdiShareVariant" size="small" class="text-ink-sage" />
        Udostępnij ten widok
        <v-spacer />
        <!-- A dialog this size covers all but a ~20px strip of a 390px phone,
             and that strip is the only thing „kliknij obok, żeby zamknąć”
             gives a touch reader. -->
        <v-btn
          :icon="mdiClose"
          variant="text"
          size="small"
          aria-label="Zamknij"
          @click="open = false"
        />
      </v-card-title>

      <v-card-text>
        <!-- The sentence above the address, in body text rather than as a
             caption under it: the complaint that started this was that the
             link „wygląda długo i strasznie”, and it is frightening because
             `visibility=private` tells the recipient nothing about being sent
             a list of drafts. Whoever pastes this reads the sentence first and
             decides from it whether the link is worth sending at all.

             On the pale sage the entity page puts its meta pills on, with the
             filter icon in front of it: `bg-surface-sage` carries its own ink
             (#46673c on #e9f1e7, 5.57:1), so the block that has to be read
             before anything is pasted is also the one piece of colour in the
             card. -->
        <div
          class="d-flex ga-2 align-start rounded-lg pa-3 mb-3 bg-surface-sage"
        >
          <v-icon :icon="mdiFilterVariant" size="small" class="mt-1" />
          <p class="text-body-1 font-weight-medium mb-0">{{ sentence }}</p>
        </div>

        <v-text-field
          ref="urlField"
          :model-value="url"
          readonly
          variant="outlined"
          density="compact"
          hide-details
          aria-label="Adres tego widoku"
          :append-inner-icon="mdiContentCopy"
          @click:append-inner="copy(url, 'Skopiowano link.')"
        />

        <!-- Offered only when it would actually change the address. Ticking a
             box that produces the same string twice is how a reader concludes
             the whole card is decorative. -->
        <v-checkbox
          v-if="canAddPaging"
          v-model="withPaging"
          density="compact"
          hide-details
          class="mt-1"
          label="Dołącz stronę i liczbę wierszy"
        />

        <div
          v-if="canAddPaging && !withPaging"
          class="text-caption text-ink-neutral mt-2"
        >
          Link nie zawiera numeru strony ani liczby wierszy. Odbiorca zacznie od
          pierwszej.
        </div>
      </v-card-text>

      <v-card-actions class="flex-wrap ga-1 justify-start px-4 pb-4">
        <v-btn
          color="primary"
          variant="flat"
          class="text-none"
          :prepend-icon="mdiContentCopy"
          @click="copy(url, 'Skopiowano link.')"
        >
          Kopiuj link
        </v-btn>
        <!-- The reason the second button exists: „Szpitale · tylko szkice · wg
             sumy ocen” plus the address is a message a recipient can act on,
             where the address alone is 168 characters of camelCase they have to
             open to understand. -->
        <v-btn
          variant="text"
          class="text-none text-ink-sage"
          :prepend-icon="mdiTextBoxOutline"
          @click="copy(`${sentence}\n${url}`, 'Skopiowano opis i link.')"
        >
          Kopiuj link z opisem
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-snackbar
    v-model="noticeShown"
    :color="noticeColor"
    :timeout="noticeTimeout"
  >
    {{ notice }}
  </v-snackbar>
</template>

<script setup lang="ts">
import {
  mdiClose,
  mdiContentCopy,
  mdiFilterVariant,
  mdiShareVariant,
  mdiTextBoxOutline,
} from "@mdi/js";
import { computed, ref } from "vue";
import type { ComponentPublicInstance } from "vue";
import {
  describeQuery,
  shareUrl,
  type QueryLookup,
  type TableQuery,
} from "~~/shared/queryUrl";

// Three root nodes, so there is no single element for a class from the parent
// to fall through to; Vue drops it with a warning instead. The query bar puts
// `flex-shrink-0` on this component to keep the button from being squeezed to
// nothing by a wrapping chip rail, and that class has to reach the button.
defineOptions({ inheritAttrs: false });

const props = defineProps<{
  /** The table query as the page holds it. Typed as `TableQuery` rather than
   * the api's `Query` because both that and a raw `route.query` are assignable
   * to it, and this card only ever reads the filters out of it. */
  query: TableQuery;
  /** Resolves the two filters whose values are ids: region names for `teryt`
   * and `companyTeryt`, company names for `place`. Optional because both lists
   * arrive over the network, and a chip that says `teryt1261` is better than
   * one that waits. */
  lookup?: QueryLookup;
}>();

const open = ref(false);
const withPaging = ref(false);

const sentence = computed(() => describeQuery(props.query, props.lookup ?? {}));

// The origin of the page the button was clicked on, not the configured
// `siteUrl`: a link shared from autopush has to point back at autopush, or the
// recipient is sent to production to look for a person who only exists on the
// staging copy.
const origin = useRequestURL().origin;

const url = computed(() =>
  shareUrl(props.query, origin, { withPaging: withPaging.value }),
);

const canAddPaging = computed(
  () =>
    shareUrl(props.query, "", { withPaging: true }) !==
    shareUrl(props.query, ""),
);

const notice = ref("");
const noticeColor = ref<string | undefined>(undefined);
const noticeTimeout = ref(3000);
const noticeShown = ref(false);

const announce = (
  text: string,
  options: { color?: string; timeout?: number } = {},
) => {
  notice.value = text;
  noticeColor.value = options.color;
  noticeTimeout.value = options.timeout ?? 3000;
  noticeShown.value = true;
};

const urlField = ref<ComponentPublicInstance | null>(null);

/** Leaves the address selected, so Ctrl+C finishes what the button could not.
 *
 * The description is not selectable this way - a text field holds one line -
 * but it is on screen directly above, and it is the address that nobody can
 * retype from memory. */
const selectUrl = () => {
  const input = urlField.value?.$el.querySelector("input");
  if (input instanceof HTMLInputElement) {
    input.focus();
    input.select();
  }
};

/** A link or a description+link actually reached the clipboard. */
const emit = defineEmits<{ copied: [] }>();

const copy = async (text: string, done: string) => {
  try {
    // Inside the try on purpose: on an insecure origin `navigator.clipboard`
    // is not merely denied, it is undefined, and the property read throws
    // before there is a promise to reject.
    await navigator.clipboard.writeText(text);
  } catch {
    // A snackbar that says „Skopiowano” over an empty clipboard is worse than
    // no snackbar: the reader pastes into Signal, gets whatever was there
    // before, and blames the site for sending the wrong link.
    selectUrl();
    announce(
      "Przeglądarka nie dała dostępu do schowka. Skopiuj ręcznie: Ctrl+C.",
      {
        // `surface-warning` and not `warning`: Vuetify picks a snackbar's ink
        // from the fill by APCA and answers #fb8c00 with white, which is
        // 2.37:1 - the sentence a reader has to act on, in the one place they
        // have just been told something went wrong. The pale token carries
        // ink.warning at 5.54:1.
        color: "surface-warning",
        timeout: 8000,
      },
    );
    return;
  }

  announce(done);
  // Only on success, and for the same reason the dialog only closes here: the
  // fallback path put the address in front of the reader to copy by hand, and
  // nobody has shared anything yet. Emitted rather than counted here, so the
  // page that shows this card is the one that names the goal.
  emit("copied");
  // Closing on the failure path would take away the field the fallback just
  // selected.
  open.value = false;
};
</script>
