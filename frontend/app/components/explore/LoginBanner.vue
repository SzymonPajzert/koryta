<template>
  <!-- `color`, as the zrzutka alert on /eksploruj/tabela already does: with
       `type="info"` alone Vuetify paints its own #2196f3 as the body text, and
       on the 12% wash the tonal variant lays under it that is 2.74:1 - the
       bold count and the icon with it. The type stays for the semantics; the
       palette's info ink on the wash its own colour then lays measures
       5.33:1. -->
  <v-alert
    type="info"
    color="ink-info"
    variant="tonal"
    class="mb-4"
    :icon="mdiAccountLock"
  >
    <!-- Wraps rather than sits in one line: on a phone the button used to be
         pushed off the right edge by the text beside it, which is where the
         page's 5px of sideways scroll came from. -->
    <div class="d-flex flex-wrap align-center justify-space-between ga-2 w-100">
      <div>
        <!-- A caller with more to say than one sentence and a count - the
             teaser of an unpublished person - says it here. -->
        <slot>
          {{ message }}
          <template v-if="hiddenCount > 0">
            W tym widoku znaleźliśmy jeszcze
            <strong>{{
              polishCounting(hiddenCount, forms[0], forms[1], forms[2])
            }}</strong
            >.
          </template>
        </slot>
      </div>
      <!-- One button sits as it always has. Two are a pair of equal width -
           side by side where they fit, and on a phone one under the other
           across the banner, rather than a short one over a long one. -->
      <div :class="signupTo ? 'login-banner__pair' : 'd-flex flex-wrap ga-2'">
        <v-btn
          color="primary"
          variant="flat"
          :to="to"
          data-testid="login-banner-login"
          @click="emit('login')"
        >
          Zaloguj się
        </v-btn>
        <!-- Outlined in the banner's own ink, which it inherits: in sage the
             label would be the 1.85:1 `text-primary` is on a light ground. -->
        <v-btn
          v-if="signupTo"
          variant="outlined"
          :to="signupTo"
          data-testid="login-banner-signup"
          @click="emit('signup')"
        >
          Zarejestruj się
        </v-btn>
      </div>
    </div>
  </v-alert>
</template>

<script setup lang="ts">
import { mdiAccountLock } from "@mdi/js";
import type { RouteLocationRaw } from "vue-router";

/** "There is more here once you log in", wherever that is true.
 *
 * The counted noun is a prop because Polish declines it three ways and the
 * banner appears over lists of different things - people on `/eksploruj/tabela`,
 * facts on an article page. Both default to the person wording, which is what
 * every existing caller means.
 */
withDefaults(
  defineProps<{
    hiddenCount?: number;
    message?: string;
    /** Singular, plural and genitive plural, as `polishCounting` takes them. */
    forms?: [string, string, string];
    /** Where „Zaloguj się" leads: a bare /login unless the caller wants the
     * reader brought back, or to say why they came. */
    to?: RouteLocationRaw;
    /** Where „Zarejestruj się" leads. Absent, there is no such button - most
     * banners stand over a list, and one button is what they always had. */
    signupTo?: RouteLocationRaw;
  }>(),
  {
    hiddenCount: 0,
    message:
      "Zaloguj się, aby uzyskać dostęp do jeszcze nieopublikowanych / niezweryfikowanych osób.",
    forms: () => ["dodatkowa osoba", "dodatkowe osoby", "dodatkowych osób"],
    to: "/login",
    signupTo: undefined,
  },
);

const emit = defineEmits<{
  /** „Zaloguj się" was clicked, for a caller that counts it. */
  login: [];
  /** „Zarejestruj się" was clicked. */
  signup: [];
}>();
</script>

<style scoped>
.login-banner__pair {
  display: grid;
  gap: 8px;
  grid-auto-columns: 1fr;
  grid-auto-flow: column;
}

@media (max-width: 599.98px) {
  .login-banner__pair {
    grid-auto-flow: row;
    width: 100%;
  }
}
</style>
