<template>
  <figure class="dclip" :data-crop-id="crop.id" data-testid="draft-declaration">
    <template v-if="crop.imageSize">
      <div v-if="images?.date" class="dclip__images">
        <OswiadczeniaCrop
          :src="images.date"
          :width="crop.imageSize.date.width"
          :height="crop.imageSize.date.height"
          :max-scale="1"
          :style="bounded(crop.imageSize.date)"
          alt="Wycinek z oświadczenia: linia z datą urodzenia"
          testid="draft-declaration-date"
        />
        <OswiadczeniaCrop
          v-if="images.name && crop.imageSize.name"
          :src="images.name"
          :width="crop.imageSize.name.width"
          :height="crop.imageSize.name.height"
          :max-scale="1"
          :min-height="48"
          :style="bounded(crop.imageSize.name)"
          alt="Wycinek z oświadczenia: imię i nazwisko"
          testid="draft-declaration-name"
        />
      </div>
      <p v-else-if="error" class="dclip__missing" data-crop-error>
        Nie udało się wczytać wycinka.
        <button type="button" class="dclip__retry" @click="load">
          Spróbuj ponownie
        </button>
      </p>
      <!-- As tall as the crop will be, so nothing under it moves when it
           arrives. -->
      <div
        v-else
        class="dclip__waiting"
        :style="{
          aspectRatio: `${crop.imageSize.date.width} / ${crop.imageSize.date.height}`,
        }"
        aria-hidden="true"
      />
    </template>
    <!-- A date the job read off a typed form settles without readers, and
         need not come with a picture. One it cut nothing from says so in
         the caption. -->
    <p v-else-if="crop.status !== 'failed'" class="dclip__missing">
      Datę odczytał program, bez wycinka.
    </p>

    <!-- The spaces are for whoever reads the text rather than the layout (a
         screen reader, a copy): the dots are drawn by CSS. -->
    <figcaption class="dclip__caption">
      <span v-if="where" class="dclip__part">{{ where }}</span
      >{{ " " }}
      <span v-if="crop.agreed" class="dclip__part">
        <AdminDeclarationsDateCompare
          :reading="crop.agreed"
          :stored="birthDate"
        />
      </span>
      <span v-else-if="state" class="dclip__part">{{ state }}</span
      >{{ " " }}
      <a
        v-if="crop.documentUrl"
        class="dclip__part dclip__doc"
        :href="crop.documentUrl"
        :title="host ?? undefined"
        target="_blank"
        rel="noopener"
        data-document-link
        >Całe oświadczenie<v-icon
          :icon="mdiOpenInNew"
          size="14"
          class="dclip__doc-icon"
      /></a>
    </figcaption>
  </figure>
</template>

<script setup lang="ts">
/** One crop of a draft's declaration, on the person's page: the line with
 * the date and, where the job cut one, the name, at no more than their own
 * pixels, and under them the unit, where the reading stands (a settled date
 * against the page's own) and the whole declaration on BIP.
 *
 * The pictures are asked for when the crop is drawn, from an endpoint
 * nothing caches: they are a named person's handwriting. */
import { computed, onMounted, ref } from "vue";
import { mdiOpenInNew } from "@mdi/js";
import { authRequest } from "~/composables/auth";
import { cropState } from "~/utils/personDeclarationCrops";
import type { PersonDeclarationCrop } from "~~/shared/declarations";

const props = defineProps<{
  crop: PersonDeclarationCrop;
  /** The page's birth date, which a settled reading is drawn against. */
  birthDate: string | null;
}>();

const images = ref<{ date: string | null; name: string | null } | null>(null);
const error = ref(false);

async function load() {
  error.value = false;
  try {
    images.value = await authRequest<{
      date: string | null;
      name: string | null;
    }>(`/api/declarations/${encodeURIComponent(props.crop.id)}/images`, {
      method: "GET",
    });
    if (!images.value.date) error.value = true;
  } catch {
    error.value = true;
  }
}

onMounted(() => {
  if (props.crop.imageSize) void load();
});

/** The tallest a line is drawn. A few crops are cut far taller than a line -
 * name crops of 475 and 675 px in the 2026-11-20 export - and drawn across
 * the column they would push the page down by a screen; held to this height
 * by the width of their frame, the handwriting is still larger than the
 * form's print. */
const MAX_LINE_HEIGHT = 120;

function bounded(size: { width: number; height: number }) {
  return size.height > MAX_LINE_HEIGHT
    ? {
        maxWidth: `${Math.round((size.width * MAX_LINE_HEIGHT) / size.height)}px`,
      }
    : undefined;
}

const where = computed(() =>
  [props.crop.office, props.crop.unit].filter(Boolean).join(" · "),
);

const state = computed(() => cropState(props.crop));

const host = computed(() => {
  try {
    return new URL(props.crop.documentUrl).host;
  } catch {
    return null;
  }
});
</script>

<style scoped>
.dclip {
  margin: 0;
  /* A crop is about 950 px wide; a reader on /oswiadczenia reads it at
     about this size too. */
  max-width: 720px;
}

.dclip__images {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dclip__waiting {
  background: rgb(var(--v-theme-surface-muted));
  border-radius: 4px;
  max-height: 120px;
  width: 100%;
}

.dclip__missing {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.8125rem;
  margin: 0;
}

.dclip__retry {
  color: rgb(var(--v-theme-ink-info));
  font-weight: 500;
  margin-inline-start: 4px;
  text-decoration: underline;
}

.dclip__retry:focus-visible,
.dclip__doc:focus-visible {
  border-radius: 2px;
  outline: 2px solid rgb(var(--v-theme-ink-info));
  outline-offset: 2px;
}

.dclip__caption {
  align-items: baseline;
  color: rgb(var(--v-theme-ink-neutral));
  display: flex;
  flex-wrap: wrap;
  font-size: 0.8125rem;
  line-height: 1.25rem;
  margin-top: 6px;
}

/* A middle dot between the parts, never at the start of a line it wrapped
   onto: it hangs off the end of the part before. */
.dclip__part:not(:last-child)::after {
  color: rgba(var(--v-theme-on-surface), 0.38);
  content: "·";
  margin: 0 6px;
}

.dclip__doc {
  color: rgb(var(--v-theme-ink-info));
  font-weight: 500;
  position: relative;
  text-decoration: none;
  white-space: nowrap;
}

/* The line is 20px tall; the target a thumb gets is 44. */
.dclip__doc::before {
  content: "";
  inset: -12px -4px;
  position: absolute;
}

.dclip__doc:hover,
.dclip__doc:focus-visible {
  text-decoration: underline;
}

.dclip__doc-icon {
  margin-inline-start: 2px;
  vertical-align: -2px;
}
</style>
