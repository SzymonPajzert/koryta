<template>
  <v-row cols="12">
    <v-col cols="12">
      <v-card>
        <v-card-text>
          Niniejsza strona została utworzona na podstawie materiałów prasowych,
          informacji zawartych w Krajowym Rejestrze Sądowym, a także w oparciu o
          inne ogólnodostępne źródła. Strona wskazuje wybrane powiązania o
          charakterze biznesowym, rodzinnym lub innym łączące niektóre osoby
          zatrudnione w spółkach, fundacjach i organizacjach zarządzanych przez
          organy polskiego państwa. Powiązanie, które zdołaliśmy ustalić i które
          w naszej opinii są istotne dla całościowego spojrzenia na proces
          wybierania ludzi na stanowiska poza konkursami. Zastrzegamy, że celem
          strony nie jest twierdzenie, że wszystkie osoby uwidocznione na mapie
          działają wspólnie lub w porozumieniu, jak również przesądzanie o
          czyjejkolwiek osobistej winie lub odpowiedzialności prawnej.
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12">
      <h3 class="text-h6 font-weight-bold">
        Źródła tej strony to między innymi:
      </h3>
    </v-col>

    <v-col cols="12">
      <v-list>
        <v-list-item
          v-for="source in articles"
          :key="source.name"
          :href="source.sourceURL"
          target="_blank"
        >
          <v-list-item-title>
            {{ source.name }}
          </v-list-item-title>
        </v-list-item>
      </v-list>
    </v-col>

    <v-col cols="12">
      <a href="https://www.flaticon.com/free-icons/pork" title="pork icons">
        Pork icons created by Freepik - Flaticon
      </a>
      <a href="https://www.flaticon.com/free-icon/pig_3800575"> - link</a>
    </v-col>
  </v-row>
</template>

<script lang="ts" setup>
const { entities: articles } = await useEntity("article");

useHead({
  title: "Źródła strony",
});
</script>
