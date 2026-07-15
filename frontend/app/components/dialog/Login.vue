<template>
  <v-dialog v-model="dialog" max-width="500">
    <template #activator="{ props: activatorProps }">
      <slot name="activator" :props="activatorProps">
        <v-btn v-bind="activatorProps" color="primary"> Zaloguj się </v-btn>
      </slot>
    </template>

    <v-card>
      <v-card-title class="d-flex justify-space-between align-center">
        <span>{{ isLogin ? "Zaloguj się" : "Rejestracja" }}</span>
        <v-btn icon variant="text" @click="dialog = false">
          <v-icon :icon="mdiClose" />
        </v-btn>
      </v-card-title>
      <v-card-text>
        <div class="mb-4 text-center">
          <a href="javascript:void(0)" @click="isLogin = !isLogin">
            {{
              isLogin
                ? "Nie masz konta? Zarejestruj się"
                : "Masz już konto? Zaloguj się"
            }}
          </a>
        </div>
        <FormLoginForm :is-login="isLogin" @success="onLoginSuccess" />
        <div class="mt-4 text-center text-caption">
          {{ isLogin ? "Logowanie się" : "Rejestracja" }} oznacza zgodę z
          <a href="/plik/regulamin">regulaminem</a> oraz
          <a href="/plik/polityka_prywatnosci">polityką prywatności</a>.
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { mdiClose } from "@mdi/js";

const dialog = defineModel<boolean>();
const isLogin = ref(true);

const emit = defineEmits<{
  (e: "success"): void;
}>();

const onLoginSuccess = () => {
  // Let the auth state propagate through firebase/vuefire
  setTimeout(() => {
    dialog.value = false;
    emit("success");
  }, 500);
};
</script>
