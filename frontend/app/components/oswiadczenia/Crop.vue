<template>
  <div
    ref="frame"
    class="ow-crop"
    :class="{
      'ow-crop--pan': panning,
      'ow-crop--more-left': panning && !atStart,
      'ow-crop--more-right': panning && !atEnd,
    }"
  >
    <!-- A region of its own while it pans, so a keyboard moves along the line
         with the arrow keys; a plain wrapper otherwise, and no tab stop. -->
    <div
      ref="scroller"
      class="ow-crop__scroller"
      :tabindex="panning ? 0 : undefined"
      :role="panning ? 'region' : undefined"
      :aria-label="panning ? `${alt}, przewijana w bok` : undefined"
      @scroll.passive="measureScroll"
    >
      <img
        :src="src"
        :width="width"
        :height="height"
        :alt="alt"
        :data-testid="testid"
        class="ow-crop__img"
        :style="imageStyle"
        draggable="false"
      />
    </div>
    <!-- How much of the line is in view and where, under it rather than over
         it: the end of a year is often right at the cut, and nothing may sit
         on handwriting. A tap on the track moves the line there. -->
    <div
      v-if="panning"
      class="ow-crop__track"
      aria-hidden="true"
      @click="jumpTo"
    >
      <span class="ow-crop__thumb" :style="thumbStyle" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useElementSize } from "@vueuse/core";

/**
 * One line cut out of a declaration, drawn so it can be read.
 *
 * A date crop is about 950 by 105 px, a name crop 1,160 by 94. On a computer
 * the column holds one at about its natural size, which is the sharpest it
 * gets: it is fitted to the column, and never blown up past `maxScale` times
 * its pixels, where a scan stops gaining detail and only gains blur.
 *
 * On a 375 px phone the same fit is about a third, a 35 px strip in which a 1
 * and a 7 are one smudge. Below `minHeight` the crop is therefore drawn larger
 * and the reader moves along it sideways. It starts at the line's left end,
 * where the form's printed „urodzony(a)” is, with the handwritten date right
 * after it, so the size is a trade between the two things a phone cannot
 * have at once: the crop is drawn as tall as `readableHeight`, but only while
 * `shown` of the line still fits the first screen - „11 marca 1970 roku”
 * ends past the middle of its line - and never below `minHeight`, where it
 * stops being readable, nor above its own pixels. One way of looking at a crop
 * for every variant, and the phone's own pinch zoom for a digit that needs a
 * closer look.
 */
const props = withDefaults(
  defineProps<{
    src: string;
    /** The crop's own pixels, as the task reports them. */
    width: number;
    height: number;
    alt: string;
    /** Below this many px tall a fitted crop is too small to read. */
    minHeight?: number;
    /** The most a crop too small at its fit is drawn as tall instead. */
    readableHeight?: number;
    /** The share of its line a crop drawn larger keeps in the first screen,
     * as long as that leaves it `minHeight` tall: the printed word and the
     * date after it are in the first half or so of the line. */
    shown?: number;
    /** The most a fitted crop is scaled by: 2 for the line being read, less
     * for one shown beside it as context. */
    maxScale?: number;
    /** On the <img>, which is what a test waits for and what it reads. */
    testid?: string;
  }>(),
  {
    minHeight: 60,
    readableHeight: 76,
    shown: 0.55,
    maxScale: 2,
    testid: undefined,
  },
);

const frame = useTemplateRef<HTMLElement>("frame");
const scroller = useTemplateRef<HTMLElement>("scroller");
const { width: frameWidth } = useElementSize(frame);

const atStart = ref(true);
const atEnd = ref(false);

/** Scale of the crop fitted to the column; 1 until the column is measured. */
const fitScale = computed(() =>
  frameWidth.value > 0
    ? Math.min(props.maxScale, frameWidth.value / props.width)
    : 1,
);

/** The scale a crop too small at its fit is drawn at instead: as tall as
 * `readableHeight` while `shown` of the line fits the column, never below
 * `minHeight` tall, and never above the crop's own pixels. */
const readableScale = computed(() => {
  const wanted = Math.min(
    props.readableHeight / props.height,
    frameWidth.value / (props.shown * props.width),
  );
  return Math.max(
    fitScale.value,
    Math.min(1, Math.max(wanted, props.minHeight / props.height)),
  );
});

/** Whether the crop is drawn larger than the column and moved along. Only
 * when the fit is too small to read and the readable size is wider than the
 * column: a short crop that fits at its own pixels just fits. */
const panning = computed(
  () =>
    frameWidth.value > 0 &&
    fitScale.value * props.height < props.minHeight &&
    props.width * readableScale.value > frameWidth.value + 1,
);

const imageStyle = computed(() =>
  panning.value
    ? {
        width: `${Math.round(props.width * readableScale.value)}px`,
        maxWidth: "none",
      }
    : {
        width: "100%",
        maxWidth: `${Math.round(props.width * props.maxScale)}px`,
      },
);

/** The part of the line in view, as shares of its width, for the track. */
const view = ref({ start: 0, size: 1 });

function measureScroll() {
  const el = scroller.value;
  if (!el) return;
  atStart.value = el.scrollLeft <= 2;
  atEnd.value = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
  view.value = el.scrollWidth
    ? {
        start: el.scrollLeft / el.scrollWidth,
        size: Math.min(1, el.clientWidth / el.scrollWidth),
      }
    : { start: 0, size: 1 };
}

const thumbStyle = computed(() => ({
  left: `${(view.value.start * 100).toFixed(2)}%`,
  width: `${(view.value.size * 100).toFixed(2)}%`,
}));

/** A tap on the track brings the part of the line under it into the middle
 * of the view. */
function jumpTo(event: MouseEvent) {
  const el = scroller.value;
  const track = event.currentTarget as HTMLElement | null;
  if (!el || !track) return;
  const share = event.offsetX / (track.clientWidth || 1);
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollTo({
    left: share * el.scrollWidth - el.clientWidth / 2,
    behavior: still ? "auto" : "smooth",
  });
}

// A new crop in the same frame starts from the beginning of its line.
watch(
  () => props.src,
  () => {
    if (scroller.value) scroller.value.scrollLeft = 0;
    void nextTick(measureScroll);
  },
);

watch(panning, () => void nextTick(measureScroll));

onMounted(measureScroll);
</script>

<style scoped>
.ow-crop {
  min-width: 0;
  position: relative;
}

.ow-crop__scroller {
  border-radius: 4px;
  line-height: 0;
}

.ow-crop__img {
  border-radius: 4px;
  display: block;
  height: auto;
  /* The scan's paper is near white, and so is the page: a hairline inside
     the edge says where the cut is without framing it in a colour. */
  outline: 1px solid rgba(0, 0, 0, 0.1);
  outline-offset: -1px;
  user-select: none;
}

.ow-crop--pan .ow-crop__scroller {
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-x: contain;
  /* The fade and the track say there is more; the browser's own bar would
     be a second track, in its own grey, and on a phone it fades away. */
  scrollbar-width: none;
}

.ow-crop--pan .ow-crop__scroller::-webkit-scrollbar {
  display: none;
}

.ow-crop--pan .ow-crop__img {
  border-radius: 0;
}

.ow-crop__scroller:focus-visible {
  outline: 2px solid rgb(var(--v-theme-ink-info));
  outline-offset: 2px;
}

/* The edge with more of the line behind it fades out, over 24 px: enough
   to say the line goes on, little enough that a year ending at the cut can
   still be made out. */
.ow-crop--more-right .ow-crop__scroller {
  -webkit-mask-image: linear-gradient(
    to right,
    black calc(100% - 24px),
    transparent
  );
  mask-image: linear-gradient(to right, black calc(100% - 24px), transparent);
}

.ow-crop--more-left .ow-crop__scroller {
  -webkit-mask-image: linear-gradient(to right, transparent, black 24px);
  mask-image: linear-gradient(to right, transparent, black 24px);
}

.ow-crop--more-left.ow-crop--more-right .ow-crop__scroller {
  -webkit-mask-image: linear-gradient(
    to right,
    transparent,
    black 24px,
    black calc(100% - 24px),
    transparent
  );
  mask-image: linear-gradient(
    to right,
    transparent,
    black 24px,
    black calc(100% - 24px),
    transparent
  );
}

/* A hairline track with the part in view on it, the way a phone draws its
   own scroll position, but there for good rather than while a finger moves. */
.ow-crop__track {
  background: rgba(var(--v-border-color), 0.12);
  border-radius: 2px;
  cursor: pointer;
  height: 3px;
  margin-top: 6px;
  position: relative;
}

/* The track is 3 px to look at; the target a thumb gets is 20. */
.ow-crop__track::after {
  content: "";
  inset: -8px 0;
  position: absolute;
}

.ow-crop__thumb {
  background: rgb(var(--v-theme-ink-neutral));
  border-radius: 2px;
  height: 100%;
  position: absolute;
  top: 0;
}
</style>
