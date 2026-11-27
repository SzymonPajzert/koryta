<!--
  The picture a platform draws when somebody shares „Partie w czasie” on
  /eksploruj/autograf: the stack itself, for the category and the years in the
  link. `shared/partyStackCard.ts` decides every value; this only draws.

  The rules of NodeCard.satori.vue hold here, for the same reasons (see the note
  at its top): every div states its `display`, no span, img or inline svg, and
  each font weight appears in a static style. So each band is a div the size
  of the chart, cut to its own area by a `clip-path: polygon(...)`.

  The colour is on a child that fills the band, never on the band itself.
  Satori 0.28.2 paints an element through the clip it inherits, not its own,
  whenever an ancestor clips - and the module wraps every card in an
  `overflow: hidden` div. A band painted itself was a full rectangle, and the
  paper-coloured seams on top blanked the whole chart. Its children do take
  its clip.
-->
<template>
  <div
    style="
      width: 1200px;
      height: 630px;
      display: flex;
      flex-direction: column;
      font-family: Roboto;
    "
    :style="{ backgroundColor: card.paper, color: card.ink }"
  >
    <!-- Band A: masthead, as on the person and company card. -->
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
        "
        :style="{ color: card.ink }"
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
        "
        :style="{ color: ink.sage }"
      >
        Partie w czasie
      </div>
    </div>

    <!-- Band B: the sage rule. -->
    <div
      style="width: 1200px; height: 3px"
      :style="{ backgroundColor: brand.primary }"
    ></div>

    <!-- Band C: what the chart counts, and the chart. -->
    <div
      style="
        flex-grow: 1;
        display: flex;
        flex-direction: column;
        padding-top: 24px;
        padding-left: 56px;
        padding-right: 56px;
        overflow: hidden;
      "
    >
      <div
        style="
          display: flex;
          height: 50px;
          max-width: 1088px;
          font-size: 44px;
          font-weight: 700;
          line-height: 1.1;
          letter-spacing: -1px;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
        "
        v-text="heading"
      ></div>
      <div
        style="
          display: flex;
          height: 32px;
          margin-top: 4px;
          align-items: center;
          font-size: 24px;
          font-weight: 500;
        "
        :style="{ color: ink.neutral }"
        v-text="subtitle"
      ></div>

      <div
        style="display: flex; position: relative; margin-top: 20px"
        :style="{ width: `${WIDTH}px`, height: `${HEIGHT}px` }"
      >
        <div
          v-for="(shape, index) in shapes"
          :key="index"
          style="display: flex; position: absolute; left: 0; top: 0"
          :style="{
            width: `${WIDTH}px`,
            height: `${HEIGHT}px`,
            clipPath: shape.clip,
          }"
        >
          <div
            style="display: flex"
            :style="{
              width: `${WIDTH}px`,
              height: `${HEIGHT}px`,
              backgroundColor: shape.color,
            }"
          ></div>
        </div>
      </div>
      <div
        style="width: 1088px; height: 2px"
        :style="{ backgroundColor: card.rule }"
      ></div>
      <div
        style="display: flex; position: relative; width: 1088px; height: 34px"
      >
        <div
          v-for="tick in axis"
          :key="`mark-${tick.year}`"
          style="display: flex; position: absolute; top: 0; width: 2px"
          :style="{
            left: `${tick.x - 1}px`,
            height: '8px',
            backgroundColor: card.rule,
          }"
        ></div>
        <div
          v-for="tick in axis"
          :key="`year-${tick.year}`"
          style="
            display: flex;
            position: absolute;
            top: 8px;
            width: 80px;
            justify-content: center;
            font-size: 20px;
            font-weight: 400;
          "
          :style="{ left: `${tick.x - 40}px`, color: ink.neutral }"
          v-text="String(tick.year)"
        ></div>
      </div>

      <div
        style="
          display: flex;
          flex-direction: row;
          flex-wrap: wrap;
          margin-top: 8px;
          max-height: 64px;
          overflow: hidden;
        "
      >
        <div
          v-for="item in legend"
          :key="item.label"
          style="
            display: flex;
            flex-direction: row;
            align-items: center;
            height: 32px;
            margin-right: 28px;
          "
        >
          <div
            style="display: flex; width: 14px; height: 14px; border-radius: 7px"
            :style="{ backgroundColor: item.color }"
          ></div>
          <div
            style="
              display: flex;
              margin-left: 8px;
              font-size: 22px;
              font-weight: 500;
            "
            :style="{ color: card.ink }"
            v-text="item.label"
          ></div>
        </div>
      </div>
    </div>

    <!-- Band D: the sage foot the static card ends on. -->
    <div
      style="width: 1200px; height: 14px"
      :style="{ backgroundColor: brand.primary }"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { brand, card, ink } from "~~/shared/colors";
import { partyColors } from "~~/shared/misc";
import { partyBandLabel } from "~~/shared/partyStack";
import { CARD_SCALE, decodeStack, decodeTicks } from "~~/shared/partyStackCard";

/** Kept in step with `PartyStackCardProps` in shared/partyStackCard.ts. A
 * prop the url left out arrives undefined, and one that reads as a number
 * („2026”) arrives as one. */
const props = defineProps<{
  heading: string;
  years: string | number;
  stack: string;
  ticks?: string;
}>();

const WIDTH = 1088;
const HEIGHT = 280;
/** The tallest point stops short of the box, clear of the line above. */
const HEADROOM = 0.94;
/** Pixels a thousandth of the tallest point is. */
const UNIT = (HEIGHT * HEADROOM) / CARD_SCALE;
/** The line between two bands, in the paper's colour, as on the page. */
const SEAM = 2;

const subtitle = computed(
  () => `${props.years}: ile osób z każdej partii było na stanowisku`,
);

const bands = computed(() => decodeStack(props.stack));

function colourOf(key: string): string {
  return partyColors[key] ?? card.rule;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Every band's area, and the paper-coloured seam along each band's top but
 * the last, drawn after the bands so it lies over both. */
const shapes = computed(() => {
  const { keys, heights } = bands.value;
  const count = Math.max(2, ...heights.map((row) => row.length));
  const xs = Array.from({ length: count }, (_, i) =>
    round((i * WIDTH) / (count - 1)),
  );
  const at = (row: number[], i: number) =>
    row.length === 1 ? row[0]! : (row[i] ?? 0);
  const polygon = (upper: number[], lower: number[]) =>
    `polygon(${[
      ...xs.map((x, i) => `${x}px ${round(HEIGHT - upper[i]!)}px`),
      ...xs.map((x, i) => `${x}px ${round(HEIGHT - lower[i]!)}px`).reverse(),
    ].join(",")})`;

  let below = xs.map(() => 0);
  const areas: { color: string; clip: string }[] = [];
  const seams: { color: string; clip: string }[] = [];
  keys.forEach((key, band) => {
    const top = below.map((base, i) => base + at(heights[band]!, i) * UNIT);
    areas.push({ color: colourOf(key), clip: polygon(top, below) });
    if (band < keys.length - 1) {
      seams.push({
        color: card.paper,
        clip: polygon(
          top.map((y) => y + SEAM / 2),
          top.map((y) => y - SEAM / 2),
        ),
      });
    }
    below = top;
  });
  return [...areas, ...seams];
});

const axis = computed(() =>
  decodeTicks(props.ticks).map(({ year, at }) => ({
    year,
    x: Math.round((at * WIDTH) / CARD_SCALE),
  })),
);

const legend = computed(() =>
  bands.value.keys.map((key) => ({
    label: partyBandLabel(key),
    color: colourOf(key),
  })),
);
</script>
