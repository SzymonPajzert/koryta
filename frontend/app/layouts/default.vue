<template>
  <v-app-bar :height="APP_BAR_HEIGHT">
    <NuxtLink to="/">
      <NuxtImg
        class="mx-2"
        src="/logo_small.png"
        width="40"
        height="40"
        fetchpriority="high"
        preload
        style="cursor: pointer; object-fit: contain"
        alt="Koryta.pl"
      />
    </NuxtLink>

    <v-app-bar-title v-if="mdAndUp">
      <NuxtLink
        to="/"
        class="text-decoration-none"
        style="color: inherit; cursor: pointer"
      >
        koryta.pl
      </NuxtLink>
    </v-app-bar-title>
    <v-spacer />
    <omni-search v-if="!route?.meta.hideSearch" />
    <v-spacer />

    <template #append>
      <v-btn v-if="mdAndUp" text to="/tematy">Tematy</v-btn>
      <v-btn v-if="mdAndUp" text to="/o-nas">O nas</v-btn>
      <v-btn v-if="mdAndUp" text to="/pomoc">Działaj z nami</v-btn>
      <ClientOnly>
        <v-btn v-if="user && pictureURL" icon to="/profil" size="32">
          <v-avatar :image="pictureURL" size="32" />
        </v-btn>
        <v-btn v-if="user && !pictureURL" icon to="/profil">
          <v-icon :icon="mdiAccount" />
        </v-btn>
        <v-btn v-if="!user" :icon="!mdAndUp" @click="loginDialog = true">
          <v-icon v-if="!mdAndUp" :icon="mdiAccount" />
          <span class="d-none d-md-inline">Zaloguj się</span>
        </v-btn>
        <v-btn v-if="user && mdAndUp" text @click="logout">Wyloguj</v-btn>
        <DialogLogin v-model="loginDialog" hide-activator />
        <template #fallback>
          <v-btn :icon="!mdAndUp" @click="loginDialog = true">
            <v-icon v-if="!mdAndUp" :icon="mdiAccount" />
            <span class="d-none d-md-inline">Zaloguj się</span>
          </v-btn>
        </template>
      </ClientOnly>
    </template>
  </v-app-bar>
  <v-main class="d-flex flex-column" :style="ssrLayoutTop">
    <ClientOnly>
      <v-toolbar
        v-if="user"
        density="compact"
        color="primary"
        class="user-toolbar"
      >
        <v-spacer />

        <!-- The panel and the three inboxes it lists, under the panel's own
             names. The activator has no `to` of its own - it would navigate
             and open the menu at once - so it is lit by hand instead. -->
        <v-menu
          v-if="isAdmin"
          location="bottom start"
          content-class="user-toolbar-menu"
        >
          <template #activator="{ props: menu }">
            <v-btn
              v-bind="menu"
              :prepend-icon="mdiShieldAccount"
              :append-icon="mdiChevronDown"
              :active="onAdminPage"
              :aria-current="onAdminPage || undefined"
              variant="text"
            >
              Admin
            </v-btn>
          </template>
          <v-list density="compact" min-width="220">
            <v-list-item
              :prepend-icon="mdiShieldAccount"
              to="/admin"
              exact
              title="Panel administracyjny"
            />
            <v-divider />
            <v-list-item
              :prepend-icon="mdiInboxArrowDown"
              to="/admin/rewizje/kolejka"
              title="Kolejka zmian"
            />
            <v-list-item
              :prepend-icon="mdiNoteEditOutline"
              to="/admin/notatki"
              title="Notatki"
            />
            <v-list-item
              :prepend-icon="mdiMessageAlertOutline"
              to="/admin/opinie"
              title="Zgłoszenia"
            />
          </v-list>
        </v-menu>
        <v-btn :prepend-icon="mdiViewList" variant="text" to="/admin/rewizje">
          Rewizje
        </v-btn>
        <v-btn
          :prepend-icon="mdiTimelineClockOutline"
          variant="text"
          to="/aktywnosc"
        >
          Aktywność
        </v-btn>
        <!-- Both leave the site. It stays a menu on pages with no affine board
             too, so the strip is the same shape on every page rather than
             growing a button a tick after the route changes. -->
        <v-menu location="bottom start" content-class="user-toolbar-menu">
          <template #activator="{ props: menu }">
            <v-btn
              v-bind="menu"
              :prepend-icon="mdiAccountGroupOutline"
              :append-icon="mdiChevronDown"
              variant="text"
            >
              Zespół
            </v-btn>
          </template>
          <v-list density="compact" min-width="220">
            <v-list-item
              :prepend-icon="mdiGithub"
              :append-icon="mdiOpenInNew"
              href="https://github.com/users/SzymonPajzert/projects/2/views/3"
              target="_blank"
              rel="noopener"
              title="Nowy bug w GitHubie"
            />
            <v-list-item
              v-if="affineLink"
              :prepend-icon="mdiCommentTextOutline"
              :append-icon="mdiOpenInNew"
              :href="`https://app.affine.pro/workspace/794db959-e4b7-4756-8db2-61cf824329fa/${affineLink}?mode=edgeless`"
              target="_blank"
              rel="noopener"
              title="Dyskusja w affine"
            />
          </v-list>
        </v-menu>
        <v-spacer icon />
      </v-toolbar>
    </ClientOnly>
    <v-container
      class="position-relative fill-height"
      :max-width="maxWidth"
      :style="{ padding: rootPadding }"
    >
      <slot />
    </v-container>
    <HomeAppFooter class="mt-auto w-100" />
    <FeedbackLauncher />
  </v-main>
</template>

<script lang="ts" setup>
import {
  mdiAccount,
  mdiAccountGroupOutline,
  mdiChevronDown,
  mdiCommentTextOutline,
  mdiGithub,
  mdiInboxArrowDown,
  mdiOpenInNew,
  mdiShieldAccount,
  mdiTimelineClockOutline,
  mdiViewList,
  mdiNoteEditOutline,
  mdiMessageAlertOutline,
} from "@mdi/js";
import { computed, ref } from "vue";
import { useAuthState } from "@/composables/auth";
import { useDisplay } from "vuetify";
import { APP_BAR_HEIGHT, useSsrLayoutTop } from "~/composables/appBar";

const ssrLayoutTop = useSsrLayoutTop();
const { mdAndUp } = useDisplay();
const { user, userConfig, logout, isAdmin } = useAuthState();
const route = useRoute();
const loginDialog = ref(false);
const maxWidth = computed(() =>
  route?.meta?.fullWidth ? "none" : (route?.meta?.maxWidth ?? 1200),
);
const rootPadding = computed(() => (route?.meta?.fullWidth ? 0 : undefined));
const affineLink = computed(() => route?.meta?.affineLink);
/** Whether the page is admin-only, which is what the "Admin" menu stands for
 * while it is closed - the panel's pages without an entry of their own too.
 * Read off the page's middleware rather than its path: /admin/rewizje and a
 * single revision live under /admin but are open to every signed-in reader,
 * and the router serves /admin/notatki/ as the same page as /admin/notatki. */
const onAdminPage = computed(() =>
  [route?.meta?.middleware].flat().includes("admin"),
);
const pictureURL = computed(() => userConfig?.data?.value?.photoURL);
</script>

<style scoped>
/* `fill-height` makes this container a flex box, and a flex item's automatic
   minimum size is its min-content - so whatever a page puts in the slot is
   never allowed to be narrower than the widest thing inside it could be. One
   long word, one row of buttons that will not wrap, and the page is not
   overflowing: it has resized, and the container, the rows and every card in
   them come out wider than the window with it.
   /eksploruj/statystyki was a 382px document in a 375px phone this way, with
   nothing on it actually clipped - it simply refused to shrink. Zeroing the
   minimum lets a page be as wide as the window and no wider; anything that
   genuinely cannot fit still sticks out, which is the honest symptom and the
   one tests/visual/phoneWidth.ts is watching for. */
.v-container.fill-height > :deep(*) {
  min-width: 0;
}

/* Vuetify clips the toolbar content, so on narrow screens the trailing
   buttons are unreachable. Let it scroll sideways instead. The spacers
   collapse to zero once the buttons overflow, so wide screens still centre. */
.user-toolbar :deep(.v-toolbar__content) {
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.user-toolbar :deep(.v-toolbar__content)::-webkit-scrollbar {
  display: none;
}

.user-toolbar :deep(.v-btn) {
  flex: 0 0 auto;
}
</style>
