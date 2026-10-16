<template>
  <ButtonIconAction
    :icon="mdiSetMerge"
    label="Ta strona to duplikat"
    tooltip="Ta strona to duplikat - scal ją z tą drugą"
    data-testid="admin-merge-node"
    @click="mergeOpen = true"
  />
  <ButtonIconAction
    :icon="mdiCallSplit"
    label="Ta strona to dwie osoby"
    tooltip="Ta strona to dwie osoby - zaznacz albo rozdziel"
    data-testid="admin-split-node"
    @click="splitOpen = true"
  />

  <AdminMergeNodeDialog
    v-model="mergeOpen"
    :node-id="nodeId"
    :node-name="nodeName"
    :node-type="nodeType"
  />
  <AdminSplitNodeDialog
    v-if="nodeType === 'person'"
    v-model="splitOpen"
    :node-id="nodeId"
    :node-name="nodeName"
  />
</template>

<script setup lang="ts">
import { ref } from "vue";
import { mdiCallSplit, mdiSetMerge } from "@mdi/js";
import type { NodeType } from "~~/shared/model";

/** The pair of buttons for the two ways one page and one person can fail to be
 * the same thing, and the dialogs behind them.
 *
 * One component rather than two mount points because they are one job: the
 * pipeline names a person by whatever spelling it read that run, so the same
 * human ends up on two pages (170 pairs share a `rejestr.io` id in the
 * 2026-08-29 export) and two humans end up on one (36 pages have had their
 * `rejestrIo` overwritten by a second person's). An admin who has just decided
 * this page is wrong is one click from either verdict.
 *
 * Splitting is offered on a person only. The endpoint creates a `person` when
 * it has to make the second page, and "these are two companies" is not a thing
 * the register lets happen.
 */
withDefaults(
  defineProps<{
    nodeId: string;
    nodeName?: string | null;
    nodeType?: NodeType;
  }>(),
  { nodeName: null, nodeType: "person" },
);

const mergeOpen = ref(false);
const splitOpen = ref(false);
</script>
