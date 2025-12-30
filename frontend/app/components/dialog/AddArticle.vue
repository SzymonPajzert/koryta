<template>
  <v-row dense>
    <v-col cols="11">
      <AlreadyExisting
        v-model="formData.sourceURL"
        entity="article"
        :create="create"
        label="Źródło"
        hint="Link do artykułu"
        autocomplete="off"
        required
        :loading="formData.isFetchingTitle"
        :disabled="formData.isFetchingTitle"
        @blur="fetchAndSetArticleTitle"
      />
    </v-col>
    <v-col cols="1">
      <v-btn
        color="grey-lighten-1"
        :href="formData.sourceURL"
        target="_blank"
        icon="mdi-open-in-new"
        variant="text"
        :disabled="!formData.sourceURL"
      />
    </v-col>

    <v-col cols="12">
      <v-text-field
        v-model="formData.name"
        label="Tytuł artykułu"
        autocomplete="off"
        :disabled="formData.isFetchingTitle"
      />
    </v-col>

    <v-col cols="12" md="8">
      <v-text-field
        v-model="formData.shortName"
        label="Skrócony tytuł"
        autocomplete="off"
        :disabled="formData.isFetchingTitle"
      />
    </v-col>

    <v-col cols="12" md="4" v-if="formData.estimates">
      <!-- TODO how to solve this issue with the type? Estimates can't be optional -->
      <v-text-field
        v-model="formData.estimates.mentionedPeople"
        label="Liczba wspomnianych osób"
        autocomplete="off"
      />
    </v-col>

    <v-col cols="12" md="2">
      <v-btn>Zrobione</v-btn>
    </v-col>

    <v-col cols="12" md="2">
      <v-btn>Zrobione</v-btn>
    </v-col>

    <v-col cols="12">
      <FormMultiTextField
        v-slot="itemProps"
        title="Wspomniane osoby"
        edge-type="mentions"
        :source-id="id"
      >
        <FormEntityPicker
          v-model="itemProps.value"
          entity="person"
          hint="np. polityk Adam albo firma XYZ"
        />
      </FormMultiTextField>
    </v-col>

    <FormMultiTextField
      v-slot="itemProps"
      title="Inna uwaga"
      edge-type="comment"
      :source-id="id"
    >
      <VTextarea
        v-model="itemProps.value.text"
        auto-grow
        rows="2"
        hint="Dodatkowe informacje, np. okoliczności nominacji, wysokość wynagrodzenia"
      />
    </FormMultiTextField>
  </v-row>
</template>

<script lang="ts" setup>
import { httpsCallable, getFunctions } from "firebase/functions";
import type { Article } from "~~/shared/model";
import { splitTitle } from "~~/shared/misc";

const firebaseApp = useFirebaseApp();
const functions = getFunctions(firebaseApp);

interface ArticleExtended extends Article {
  isFetchingTitle?: boolean;
}

const formData = defineModel<Partial<ArticleExtended>>({ required: true });
const { create } = defineProps<{ create?: boolean }>();
// TODO actually set it
const id = "0";

const getPageTitle = httpsCallable(functions, "getPageTitle");

const fetchAndSetArticleTitle = async () => {
  if (formData.value.sourceURL && !formData.value.name) {
    formData.value.isFetchingTitle = true;
    try {
      const result = await getPageTitle({ url: formData.value.sourceURL });
      const title: string | undefined = (
        result.data as unknown as { title: string }
      ).title;
      formData.value.name = title || "";
      formData.value.shortName = title ? splitTitle(title, 1)[0] : undefined;
    } catch (error) {
      console.error("Error fetching page title:", error);
      formData.value.name = "";
    } finally {
      formData.value.isFetchingTitle = false;
    }
  }
};
</script>
