<!--
  The picture a platform draws when somebody shares a person or an institution.

  One template for both: the bands, the geometry and every colour are identical,
  and only the strings differ. `app/composables/ogCard.ts` decides all of them -
  nothing here computes anything about the entity, which is what lets the Polish
  be unit-tested.

  Satori, not a browser. That constrains the markup more than it looks:

  - The `.satori.vue` suffix is what registers this component at all, and it is
    what picks the renderer. Run `npx nuxt prepare` after touching the filename
    or `defineOgImageComponent("NodeCard", ...)` stops type-checking.

  - **Every div states an explicit `display`.** The module renders this template
    to html and parses it back, and the parse keeps the newline and the indent
    around `{{ ... }}` as text nodes of their own - so a div that reads as one
    line of text here arrives at satori with three children. Satori accepts that
    only for `display: flex`, `contents` or `none`; the module's own transformer
    injects `display:flex; flex-direction:column` into a child-bearing div that
    named none, which would silently stack those whitespace runs vertically.

  - **There is no `display: block` and no `line-clamp` anywhere**, however much
    the two-line name looks like a job for them. Satori rejects a `block` div
    outright here - every card 500'd with `Expected <div> to have explicit
    "display: flex"` until this went - and `line-clamp` does nothing without it.
    What actually cuts a long name to two lines is `max-height` plus
    `overflow: hidden`: the text wraps normally and the box clips it at a line
    boundary. The max-height is `floor(2 x line-height x font-size) - 4`; the
    -4 is measured, not padding, and without it the top of the third line
    bleeds through as a row of specks.

  - The three clipped divs - the name and the two stat labels - take their text
    through `v-text` rather than `{{ }}`. Not load-bearing now that nothing is
    `block`, but those are the ones whose height is measured, and `v-text` keeps
    each to exactly one child whatever a formatter does to the indentation. The
    single-line divs interpolate normally; their `display: flex` makes the
    surrounding whitespace nodes harmless.

  - Empty divs (the rule, the spacer, the hairline, the dividers, and band D
    when there are no stats) are written with no whitespace between the tags.

  - No <span>, <strong> or <p>: the module forces inline elements to
    `display:flex; flex-wrap:wrap; gap:0.2em`, which opens visible gaps between
    text runs. Every line of text is one pre-joined string in one div.

  - `font-weight` 700, 500 and 400 each appear in a fully static `style`
    attribute somewhere below. The weight harvester greps the template text, so
    a weight only reachable through a binding never gets downloaded.

  - No <img> and no inline <svg> anywhere. A root-relative image src is inlined
    at runtime through `fetchLocalAsset`, and on a miss it is rewritten to an
    absolute self-URL that satori's SSRF guard can reject - turning a cosmetic
    failure into a total one that Facebook then caches for days. A card made of
    text and rectangles has no such failure mode.
-->
<template>
  <div
    style="
      width: 1200px;
      height: 630px;
      display: flex;
      flex-direction: column;
      background-color: #f6faf4;
      font-family: Roboto;
      color: #1d1d1b;
    "
  >
    <!-- Band A: masthead. The wordmark shares the band with the eyebrow so it
         is not brand-only real estate. -->
    <div
      style="
        height: 88px;
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
        padding-left: 56px;
        padding-right: 56px;
      "
    >
      <div
        style="
          display: flex;
          font-size: 32px;
          font-weight: 700;
          letter-spacing: -0.5px;
          color: #1d1d1b;
        "
      >
        koryta.pl
      </div>
      <div
        style="
          display: flex;
          font-size: 24px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 4px;
          color: #46673c;
          max-width: 800px;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
        "
      >
        {{ eyebrow }}
      </div>
    </div>

    <!-- Band B: the sage rule. -->
    <div style="width: 1200px; height: 3px; background-color: #a8c79f"></div>

    <!-- Band C: the nameplate. -->
    <div
      style="
        flex-grow: 1;
        display: flex;
        flex-direction: column;
        padding-top: 34px;
        padding-left: 56px;
        padding-right: 56px;
        padding-bottom: 20px;
        overflow: hidden;
      "
    >
      <div
        style="
          height: 52px;
          display: flex;
          flex-direction: row;
          align-items: center;
        "
      >
        <div :style="chipStyle">
          <div
            :style="`display:flex;font-size:26px;font-weight:500;color:${chipInk};max-width:600px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis`"
          >
            {{ chipLabel }}
          </div>
        </div>
      </div>

      <div :style="nameStyle" v-text="name"></div>

      <div
        v-if="fact"
        style="
          display: flex;
          margin-top: 24px;
          width: 1088px;
          font-size: 32px;
          font-weight: 500;
          color: #1d1d1b;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
        "
      >
        {{ fact }}
      </div>

      <div style="flex-grow: 1"></div>

      <div style="width: 1088px; height: 2px; background-color: #c3d4bd"></div>

      <div
        style="
          display: flex;
          margin-top: 14px;
          width: 1088px;
          font-size: 22px;
          font-weight: 400;
          color: #4c616b;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
        "
      >
        {{ foot }}
      </div>
    </div>

    <!-- Band D: the figures, on the sage block. Black on sage is 10.62:1, which
         is the one element still readable as DATA at thumbnail scale. With
         nothing to show it collapses to the 16px band the static card ends on,
         rather than printing a row of zeroes. -->
    <div
      v-if="statCount === 0"
      style="width: 1200px; height: 16px; background-color: #a8c79f"
    ></div>
    <div
      v-else
      style="
        width: 1200px;
        height: 132px;
        background-color: #a8c79f;
        display: flex;
        flex-direction: row;
        align-items: center;
        padding-left: 56px;
        padding-right: 56px;
      "
    >
      <div
        v-if="statCount === 1"
        style="display: flex; flex-direction: row; align-items: center"
      >
        <div
          style="
            display: flex;
            font-size: 96px;
            font-weight: 700;
            color: #0b0b0b;
            line-height: 1;
          "
        >
          {{ stat1Value }}
        </div>
        <div
          style="
            display: flex;
            margin-left: 24px;
            font-size: 30px;
            font-weight: 500;
            color: #0b0b0b;
            line-height: 1.15;
            overflow: hidden;
            max-width: 860px;
            max-height: 65px;
          "
          v-text="stat1Label"
        ></div>
      </div>

      <div
        v-else
        style="display: flex; flex-direction: row; align-items: center"
      >
        <template v-for="(cell, index) in cells" :key="cell.label">
          <!-- White on sage is 1.76:1, so it is a shape and never carries text. -->
          <div
            v-if="index > 0"
            style="
              width: 2px;
              height: 72px;
              background-color: #ffffff;
              margin-left: 22px;
              margin-right: 22px;
            "
          ></div>
          <div
            :style="`display:flex;flex-direction:column;justify-content:center;width:${cellWidth}px`"
          >
            <div
              style="
                display: flex;
                font-size: 64px;
                font-weight: 700;
                color: #0b0b0b;
                line-height: 1;
              "
            >
              {{ cell.value }}
            </div>
            <div
              :style="`display:flex;margin-top:6px;font-size:24px;font-weight:500;color:#0b0b0b;line-height:1.15;overflow:hidden;max-height:51px;width:${cellWidth}px`"
              v-text="cell.label"
            ></div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/** Kept in step with `NodeCardProps` in app/composables/ogCard.ts, which is
 * where every one of these values is decided. */
const props = defineProps<{
  name: string;
  eyebrow: string;
  chipLabel: string;
  chipFill: string;
  chipInk: string;
  chipRule: string;
  nameSize: number;
  fact: string;
  foot: string;
  stat1Value: string;
  stat1Label: string;
  stat2Value: string;
  stat2Label: string;
  stat3Value: string;
  stat3Label: string;
}>();

const cells = computed(() =>
  [
    { value: props.stat1Value, label: props.stat1Label },
    { value: props.stat2Value, label: props.stat2Label },
    { value: props.stat3Value, label: props.stat3Label },
  ].filter((c) => !!c.value),
);
const statCount = computed(() => cells.value.length);
const cellWidth = computed(() => (statCount.value === 3 ? 330 : 500));

/** An empty fill means an outline chip: the `background-color` property has to
 * be absent, not transparent. */
const chipStyle = computed(
  () =>
    `display:flex;flex-direction:row;align-items:center;height:52px;padding-left:20px;padding-right:20px;border-radius:12px;border:2px solid ${props.chipRule}` +
    (props.chipFill ? `;background-color:${props.chipFill}` : ""),
);

/** Two lines of this size, and not a pixel of the third. See the note at the
 * top: this is what stands in for `line-clamp`, which satori cannot do here. */
function twoLines(fontSize: number, lineHeight: number): number {
  return Math.floor(2 * lineHeight * fontSize) - 4;
}

/** The name, clipped to two lines by `max-height` rather than by a clamp. */
const nameStyle = computed(
  () =>
    `margin-top:26px;width:1088px;display:flex;overflow:hidden;` +
    `max-height:${twoLines(props.nameSize, 1.06)}px;font-size:${props.nameSize}px;` +
    `font-weight:700;line-height:1.06;letter-spacing:-1px;color:#1d1d1b`,
);
</script>
