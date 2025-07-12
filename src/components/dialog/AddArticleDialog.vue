<template>
  <v-row dense>
    <v-col
      cols="11"
    >
      <AlreadyExisting
        v-model="formData.sourceURL"
        entity="data"
        :create="create"
        label="Źródło"
        hint="Link do artykułu"
        autocomplete="off"
        required
        @blur="fetchAndSetArticleTitle"
        :loading="formData.isFetchingTitle"
        :disabled="formData.isFetchingTitle" />
    </v-col>
    <v-col cols="1">
      <v-btn
        color="grey-lighten-1"
        :href="formData.sourceURL"
        target="_none"
        icon="mdi-pencil-outline"
        variant="text"
      ></v-btn>
    </v-col>

    <v-col cols="12">
      <v-text-field
        v-model="formData.name"
        label="Tytuł artykułu"
        autocomplete="off"
        :disabled="formData.isFetchingTitle"
      ></v-text-field>
    </v-col>

    <v-col cols="12" md="8">
      <v-text-field
        v-model="formData.shortName"
        label="Skrócony tytuł"
        autocomplete="off"
        :disabled="formData.isFetchingTitle"
      ></v-text-field>
    </v-col>

    <v-col cols="12" md="4">
      <!-- TODO how to solve this issue with the type? Estimates can't be optional -->
      <v-text-field
        v-model="formData.estimates.mentionedPeople"
        label="Liczba wspomnianych osób"
        autocomplete="off"
      ></v-text-field>
    </v-col>

    <MultiTextField
      title="Wspomniane osoby"
      v-model="formData.people"
      field-type="entityPicker"
      :field-component="EntityPicker"
      entity="employed"
      hint="np. polityk Adam"
      add-item-tooltip="Dodaj kolejną osobę"
      remove-item-tooltip="Usuń osobę"
      :empty-value="() => emptyEntityPicker('employed')"
    />

    <MultiTextField
      title="Wspomniane firmy / ministerstra"
      v-model="formData.companies"
      field-type="entityPicker"
      :field-component="EntityPicker"
      entity="company"
      hint="np. spółka skarbu państwa"
      add-item-tooltip="Dodaj kolejne miejsce"
      remove-item-tooltip="Usuń miejsce"
      :empty-value="() => emptyEntityPicker('company')"
    />

    <MultiTextField
      title="Co jest w nim ciekawego"
      v-model="formData.comments"
      field-type="textarea"
      :field-component="TextableWrap"
      :empty-value="emptyTextable"
      hint="Ciekawa informacja z artykułu, ile osób w nim jest wspomnianych"
      add-item-tooltip="Dodaj kolejne zadanie"
      remove-item-tooltip="Usuń zadanie"
    />
  </v-row>
</template>

<script lang="ts" setup>
  import { functions } from '@/firebase'
  import { httpsCallable } from 'firebase/functions';
  import type { Article } from '@/composables/model';
  import { emptyTextable, emptyEntityPicker } from "@/composables/multiTextHelper";
  import TextableWrap from '../forms/TextableWrap.vue';
  import EntityPicker from '../forms/EntityPicker.vue';
  import { splitTitle } from '@/composables/entities/articles';

  interface ArticleExtended extends Article {
    isFetchingTitle?: boolean;
  }

  const formData = defineModel<ArticleExtended>({required: true});
  const { create } = defineProps<{ create?: boolean }>();

  const getPageTitle = httpsCallable(functions, 'getPageTitle');

  const fetchAndSetArticleTitle = async () => {
    if (formData.value.sourceURL && !formData.value.name) {
      formData.value.isFetchingTitle = true;
      try {
        const result = await getPageTitle({ url: formData.value.sourceURL });
        const title: string | undefined = (result.data as any).title;
        formData.value.name = title || '';
        formData.value.shortName = title ? splitTitle(title, 1)[0] : undefined;
      } catch (error) {
        console.error("Error fetching page title:", error);
        formData.value.name = '';
      } finally {
        formData.value.isFetchingTitle = false;
      }
    }
  };
</script>
