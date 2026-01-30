<template>
  <v-card v-if="type == 'person'" width="100%" variant="flat">
    <v-card-title class="headline px-0">
      <PartyChip
        v-for="party in personEntity?.parties"
        :key="party"
        :party="party"
      />
      <h2 class="text-h5 font-weight-bold">
        {{ entity?.name }}
      </h2>
    </v-card-title>
    <v-card-subtitle v-if="personEntity?.birthDate" class="px-0">
      Data urodzenia: {{ personEntity.birthDate }}
    </v-card-subtitle>
    <v-card-text class="px-0">
      <div v-if="personEntity?.wikipedia" class="text-caption mb-2">
        Wikipedia:
        <a :href="personEntity?.wikipedia" target="_blank">{{
          personEntity?.wikipedia
        }}</a>
      </div>
      <div v-if="personEntity?.rejestrIo" class="text-caption mb-2">
        Rejestr.io:
        <a :href="personEntity?.rejestrIo" target="_blank">{{
          personEntity?.rejestrIo
        }}</a>
      </div>
      {{ entity?.content }}
    </v-card-text>
  </v-card>

  <v-card v-if="type == 'place'" width="100%" variant="flat">
    <v-card-title class="headline px-0">
      <v-icon start icon="mdi-office-building-outline" />
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
      <v-icon start icon="mdi-file-document-outline" />
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
      <v-icon start icon="mdi-map-marker-radius-outline" />
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
import type { Person, Company, Article, Region } from "~~/shared/model";

const props = defineProps<{
  entity: any;
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
