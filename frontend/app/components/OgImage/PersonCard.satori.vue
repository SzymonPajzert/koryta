<!--
  The picture a platform draws when somebody shares a person's page, laid out
  as that page is (decision on 2026-11-28): the name and its party chips, then
  rows of „Historia powiązań”, each with its bar on one shared axis.
  `app/composables/personCard.ts` decides every value; this only draws.

  Satori, so the rules at the top of NodeCard.satori.vue hold: every div states
  its `display`, no span, img or svg, and each font weight appears in a static
  style. The page's row icons are left out for the same reason.

  No local may share a prop's name: nuxt-og-image reads the props off the
  compiled script setup, and a local of the same name hides the prop, which is
  then dropped from every url.
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
    :style="{ backgroundColor: card.paper }"
  >
    <!-- Band A: the masthead, with the wordmark alone: on a person's page
         the reader can tell it is a person (decision on 2026-11-28). -->
    <div
      style="
        height: 88px;
        display: flex;
        flex-direction: row;
        align-items: center;
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
    </div>
    <!-- Band B: the sage rule. -->
    <div
      style="width: 1200px; height: 3px"
      :style="{ backgroundColor: brand.primary }"
    ></div>

    <!-- Band C: the page's title row, then its history. -->
    <div
      style="
        flex-grow: 1;
        display: flex;
        flex-direction: column;
        padding-top: 28px;
        padding-left: 56px;
        padding-right: 56px;
        overflow: hidden;
      "
    >
      <div
        style="
          display: flex;
          flex-direction: row;
          flex-wrap: wrap;
          align-items: center;
        "
      >
        <div
          style="
            display: flex;
            font-weight: 700;
            letter-spacing: -1px;
            line-height: 1.15;
            margin-right: 16px;
          "
          :style="{ fontSize: `${nameSize}px`, color: card.ink }"
          v-text="name"
        ></div>
        <div
          v-for="chip in partyChips"
          :key="chip.label"
          style="
            display: flex;
            align-items: center;
            height: 46px;
            padding-left: 14px;
            padding-right: 14px;
            margin-right: 10px;
            border-radius: 8px;
            font-size: 26px;
            font-weight: 700;
          "
          :style="{ backgroundColor: chip.fill, color: chip.ink }"
          v-text="chip.label"
        ></div>
      </div>

      <div
        style="
          display: flex;
          margin-top: 22px;
          font-size: 26px;
          font-weight: 500;
        "
        :style="{ color: card.ink }"
      >
        Historia powiązań
      </div>

      <div
        v-for="(row, index) in rows"
        :key="index"
        style="
          display: flex;
          flex-direction: row;
          align-items: center;
          height: 82px;
          margin-top: 10px;
          padding-left: 22px;
          padding-right: 22px;
          border-radius: 8px;
        "
        :style="{
          backgroundColor: surface.white,
          border: `1px solid ${ROW_EDGE}`,
        }"
      >
        <div
          style="
            display: flex;
            flex-direction: column;
            overflow: hidden;
            margin-right: 24px;
          "
          :style="{ width: `${LEFT}px` }"
        >
          <div
            style="
              display: flex;
              font-size: 22px;
              font-weight: 700;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            "
            :style="{ color: card.ink, maxWidth: `${LEFT}px` }"
            v-text="row.name"
          ></div>
          <div
            style="
              display: flex;
              flex-direction: row;
              align-items: center;
              margin-top: 6px;
            "
          >
            <div
              style="
                display: flex;
                font-size: 18px;
                font-weight: 400;
                white-space: nowrap;
              "
              :style="{ color: ink.neutral }"
              v-text="row.role"
            ></div>
            <div
              v-if="row.isPublic"
              style="
                display: flex;
                margin-left: 12px;
                padding-left: 10px;
                padding-right: 10px;
                height: 26px;
                align-items: center;
                border-radius: 13px;
                font-size: 15px;
                font-weight: 500;
                white-space: nowrap;
              "
              :style="{ backgroundColor: brand.primary, color: ink.strong }"
            >
              Instytucja publiczna
            </div>
            <div
              v-if="row.sector"
              style="
                display: flex;
                margin-left: 10px;
                padding-left: 10px;
                padding-right: 10px;
                height: 26px;
                align-items: center;
                border-radius: 13px;
                font-size: 15px;
                font-weight: 500;
                white-space: nowrap;
              "
              :style="{ backgroundColor: surface.muted, color: ink.neutral }"
              v-text="row.sector"
            ></div>
          </div>
        </div>

        <!-- The post on the card's shared axis. -->
        <div
          style="display: flex; flex-direction: column"
          :style="{ width: `${BAR}px` }"
        >
          <div
            style="
              display: flex;
              position: relative;
              height: 12px;
              border-radius: 6px;
              overflow: hidden;
            "
            :style="{ width: `${BAR}px`, backgroundColor: AXIS_TRACK }"
          >
            <div
              style="
                display: flex;
                position: absolute;
                top: 0;
                height: 12px;
                border-radius: 6px;
              "
              :style="{
                left: `${row.left}px`,
                width: `${row.width}px`,
                backgroundColor: statusFill.success,
              }"
            ></div>
          </div>
          <div
            style="
              display: flex;
              margin-top: 8px;
              font-size: 17px;
              font-weight: 400;
              white-space: nowrap;
            "
            :style="{ color: ink.neutral, marginLeft: `${row.labelAt}px` }"
            v-text="row.period"
          ></div>
        </div>
      </div>

      <div
        v-if="more"
        style="
          display: flex;
          margin-top: 12px;
          font-size: 20px;
          font-weight: 500;
        "
        :style="{ color: ink.neutral }"
        v-text="more"
      ></div>
    </div>

    <!-- Band D: the sage foot the cards end on. -->
    <div
      style="width: 1200px; height: 14px"
      :style="{ backgroundColor: brand.primary }"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { brand, card, ink, statusFill, surface } from "~~/shared/colors";
import { partyChipPaint } from "~~/shared/misc";
import { BAR_SCALE } from "~/composables/personCard";
import { ink as chartInk } from "~/utils/chartTheme";

/** Kept in step with `PersonCardProps` in app/composables/personCard.ts. A
 * prop the url left out arrives undefined, and a numeral arrives as a
 * number. */
const props = defineProps<{
  name: string;
  nameSize: number;
  party1?: string;
  party2?: string;
  party3?: string;
  row1Name?: string;
  row1Role?: string;
  row1Public?: string;
  row1Sector?: string;
  row1Period?: string;
  row1From?: number;
  row1To?: number;
  row2Name?: string;
  row2Role?: string;
  row2Public?: string;
  row2Sector?: string;
  row2Period?: string;
  row2From?: number;
  row2To?: number;
  row3Name?: string;
  row3Role?: string;
  row3Public?: string;
  row3Sector?: string;
  row3Period?: string;
  row3From?: number;
  row3To?: number;
  more?: string;
}>();

/** The site's hairline, .12. */
const ROW_EDGE = "rgba(0, 0, 0, 0.12)";
/** The charts' pale track, under a bar. */
const AXIS_TRACK = chartInk.track;
/** A row's two columns: what the post is, and when. 1088 of content, less a
 * row's padding and the gap between them. */
const LEFT = 520;
const BAR = 476;
/** Room the dates under a bar take, so they never run off its end. */
const LABEL = 210;
/** A bar is never drawn shorter than its own height. */
const MIN_BAR = 12;

const partyChips = computed(() =>
  [props.party1, props.party2, props.party3]
    .filter((party): party is string => !!party)
    .map((party) => {
      const paint = partyChipPaint(party);
      return {
        label: party,
        fill: paint?.backgroundColor ?? surface.muted,
        ink: paint?.color ?? ink.strong,
      };
    }),
);

/** Roughly what the chips line takes: the sector chip is dropped where it
 * would be cut off at the column's edge. */
function fitsSector(role: string, isPublic: boolean, sector: string): boolean {
  const width =
    role.length * 9.5 + (isPublic ? 172 : 0) + sector.length * 8 + 40;
  return width <= LEFT;
}

const rows = computed(() =>
  [
    [
      props.row1Name,
      props.row1Role,
      props.row1Public,
      props.row1Sector,
      props.row1Period,
      props.row1From,
      props.row1To,
    ],
    [
      props.row2Name,
      props.row2Role,
      props.row2Public,
      props.row2Sector,
      props.row2Period,
      props.row2From,
      props.row2To,
    ],
    [
      props.row3Name,
      props.row3Role,
      props.row3Public,
      props.row3Sector,
      props.row3Period,
      props.row3From,
      props.row3To,
    ],
  ]
    .filter(([rowName]) => !!rowName)
    .map(([rowName, role, isPublic, sector, period, from, to]) => {
      const start = Math.round(((Number(from) || 0) / BAR_SCALE) * BAR);
      const end = Math.round(((Number(to) || 0) / BAR_SCALE) * BAR);
      const left = Math.min(start, BAR - MIN_BAR);
      const roleText = String(role ?? "");
      const sectorText = String(sector ?? "");
      return {
        name: String(rowName),
        role: roleText,
        isPublic: !!isPublic,
        sector: fitsSector(roleText, !!isPublic, sectorText) ? sectorText : "",
        period: String(period ?? ""),
        left,
        width: Math.max(MIN_BAR, end - left),
        labelAt: Math.max(0, Math.min(left, BAR - LABEL)),
      };
    }),
);
</script>
