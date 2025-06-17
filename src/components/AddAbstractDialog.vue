<template>
  <div>
    <v-dialog
    v-model="dialog"
    max-width="600"
  >
    <template v-slot:activator="{ props: activatorProps }">
      <!-- If user is logged in, show button to open dialog -->
      <v-btn
        v-if="user"
        :text="props.buttonText"
        v-bind="activatorProps"
      ></v-btn>
      <!-- If user is not logged in, show button to redirect to login -->
      <v-btn
        v-else
        :text="props.buttonText"
        to="/login"
      ></v-btn>
    </template>

    <v-card
      :prepend-icon="props.titleIcon"
      :title="props.title"
    >
      <v-card-text>
        <slot>
          TODO
        </slot>
      </v-card-text>

      <v-divider></v-divider>

      <v-card-actions>
        <v-spacer></v-spacer>

        <v-btn
          text="Zamknij"
          variant="plain"
          @click="dialog = false"
        ></v-btn>

        <v-btn
          color="primary"
          text="Dodaj"
          variant="tonal"
          @click="saveSuggestion()"
        ></v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

    <v-snackbar
      v-model="showConfirmationSnackbar"
      :timeout="3000"
      color="success"
      location="top end"
    >
      Sugestia została pomyślnie dodana!
      <template v-slot:actions>
        <v-btn
          variant="text"
          @click="showConfirmationSnackbar = false"
        >
          Zamknij
        </v-btn>
      </template>
    </v-snackbar>
  </div>
</template>

<script lang="ts" setup>
  import { useAuthState } from '@/composables/auth'
  import { useReadDB } from '@/composables/staticDB'
  import { shallowRef, ref as vueRef } from 'vue'
  import { ref as dbRef, push } from 'firebase/database';

  const { user, isAdmin } = useAuthState();
  const { db } = useReadDB();
  const props = defineProps<{
    buttonText: string;
    title: string;
    titleIcon: string;
    suggestionPath: string;
    adminSuggestionPath?: string;
    suggestionType: string;
    initialFormData: () => any;
    toOutput: (formData: any) => Record<string, any>;
  }>();
  const formData = defineModel<any>();
  formData.value = props.initialFormData();

  const dialog = shallowRef(false);
  const showConfirmationSnackbar = vueRef(false);

  const saveSuggestion = () => {
    if (!user.value?.uid) {
      console.error("User not authenticated or UID not available.");
      // Można tu dodać powiadomienie dla użytkownika
      return;
    }

    let submitPath = dbRef(db, props.suggestionPath)
    if (props.adminSuggestionPath && isAdmin.value) {
      submitPath = dbRef(db, props.adminSuggestionPath)
    }

    const output = props.toOutput(formData.value)

    const keyRef = push(submitPath, {
      ...output,
      date: Date.now(),
      user: user.value?.uid,
    }).key;
    push(dbRef(db, `user/${user.value?.uid}/suggestions/${props.suggestionType}`), keyRef)

    dialog.value = false;
    // Reset form data
    formData.value = props.initialFormData();
    // Show confirmation snackbar
    showConfirmationSnackbar.value = true;
  };
</script>
