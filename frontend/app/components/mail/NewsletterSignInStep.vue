<template>
  <!-- What the sign-in dialog shows once somebody has signed in through it:
       the newsletter question, for a reader who has never answered it, and
       nothing for anybody else. Its own component so that the dialog, which
       the header keeps on every page, reads the account's user document only
       after a sign-in in it, not on every page for everybody. -->
  <MailNewsletterQuestion
    v-if="asking"
    :where="signedUp ? 'signup' : 'login'"
    :status="status"
    :verification-sent="signedUp"
    autofocus
    @answered="({ note }) => emit('done', note)"
  />
  <div v-else class="d-flex justify-center py-6">
    <v-progress-circular indeterminate aria-label="Logowanie" />
  </div>
</template>

<script setup lang="ts">
import { useCurrentUser } from "vuefire";
import { useNewsletterQuestion } from "~/composables/newsletter";

const props = defineProps<{
  /** The sign-in just now created the account. */
  signedUp: boolean;
}>();

const emit = defineEmits<{
  /** The dialog can close. `note` is what to tell the reader, if anything. */
  done: [note?: string];
}>();

const user = useCurrentUser();
const { whenKnown } = useNewsletterQuestion();
const asking = ref(false);

const status = computed(() => {
  const who = user.value?.displayName || user.value?.email || "";
  if (!props.signedUp) return `Zalogowano jako ${who}.`;
  return user.value?.emailVerified
    ? "Konto założone."
    : `Konto założone. Link potwierdzający wysłaliśmy na ${user.value?.email}.`;
});

onMounted(async () => {
  if (await whenKnown()) {
    asking.value = true;
    return;
  }
  // Not asked. A new account's confirmation link went out all the same, and
  // nothing else in the dialog says so.
  emit(
    "done",
    props.signedUp && user.value && !user.value.emailVerified
      ? `Konto założone. Link potwierdzający wysłaliśmy na ${user.value.email}.`
      : undefined,
  );
});
</script>
