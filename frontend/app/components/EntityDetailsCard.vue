<template>
  <v-card v-if="type == 'person'" width="100%" variant="flat">
    <v-card-title class="px-0 d-flex">
      <h2 class="text-h5 font-weight-bold mr-2">
        {{ entity?.name }}
      </h2>
      <PartyChip
        v-for="party in personEntity?.parties"
        :key="party"
        :party="party"
      />
      <v-spacer />
      <div class="d-none d-md-inline">
        <v-spacer />
        <ButtonVoteWidget
          v-if="entity"
          :id="entity.id ?? ''"
          :key="(entity.id ?? '') + '-interesting'"
          category="interesting"
        />
        <ButtonVoteWidget
          v-if="entity"
          :id="entity.id ?? ''"
          :key="(entity.id ?? '') + '-quality'"
          category="quality"
        />
      </div>
    </v-card-title>
    <template #append> </template>
    <v-card-text class="px-0 pt-2">
      <CardPersonInfo :person="personEntity" class="mb-2" />
      {{ entity?.content }}
    </v-card-text>
  </v-card>

  <v-card v-if="type == 'place'" width="100%" variant="flat">
    <v-card-title class="headline px-0">
      <v-icon start :icon="mdiOfficeBuildingOutline" />
      <h2 class="text-h5 font-weight-bold d-inline">
        {{ entity?.name }}
      </h2>
    </v-card-title>
    <v-card-text class="px-0">
      <div v-if="company?.krsNumber" class="text-caption mb-2">
        KRS: {{ company?.krsNumber }}
      </div>
      {{ entity?.content }}
    </v-card-text>
  </v-card>

  <v-card v-if="type == 'article'" width="100%" variant="flat">
    <v-card-title class="headline px-0">
      <v-icon start :icon="mdiFileDocumentOutline" />
      <h2 class="text-h5 font-weight-bold d-inline">
        {{ entity?.name }}
      </h2>
    </v-card-title>
    <v-card-text class="px-0">
      <div v-if="article?.sourceURL" class="text-caption mb-2">
        URL:
        <a :href="article?.sourceURL" target="_blank">{{
          article?.sourceURL
        }}</a>
      </div>
      {{ entity?.content }}
    </v-card-text>
  </v-card>

  <v-card v-if="type == 'region'" width="100%" variant="flat">
    <v-card-title class="headline px-0">
      <v-icon start :icon="mdiMapMarkerRadiusOutline" />
      <h2 class="text-h5 font-weight-bold d-inline">
        {{ region?.name }}
      </h2>
    </v-card-title>
    <v-card-text class="px-0">
      {{ region?.content }}
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import {
  mdiFileDocumentOutline,
  mdiMapMarkerRadiusOutline,
  mdiOfficeBuildingOutline,
} from "@mdi/js";
import type { Person, Company, Article, Region } from "~~/shared/model";

const props = defineProps<{
  entity: Company | Person | Article | Region;
  type: string;
}>();

const company = computed(() =>
  props.type === "place" ? (props.entity as Company) : undefined,
);
const article = computed(() =>
  props.type === "article" ? (props.entity as Article) : undefined,
);
const region = computed(() =>
  props.type === "region" ? (props.entity as Region) : undefined,
);

const personEntity = computed(() =>
  props.type === "person" ? (props.entity as Person) : undefined,
);
</script>
