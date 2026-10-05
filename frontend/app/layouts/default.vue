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

        <!-- The panel and two of the inboxes it lists, under the panel's own
             names; the third, "Zgłoszenia", is under "Zespół" with the QA list
             and its problems, since a problem found there is a report too.
             "Użytkownicy" is for the administrators past their trial.
             "Zadania" is the owner's own list, shown to him alone. "Procesy",
             the jobs' progress next to it, is the datascience group's, and
             the group is not only administrators: somebody in it alone gets
             the menu with that one entry, and none of the panel's.
             The activator has no `to` of its own - it would navigate and open
             the menu at once - so it is lit by hand instead. -->
        <v-menu
          v-if="isAdmin || isDatascience"
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
              v-if="isAdmin"
              :prepend-icon="mdiShieldAccount"
              to="/admin"
              exact
              title="Panel administracyjny"
            />
            <v-divider v-if="isAdmin" />
            <!-- The queue is the first section of /admin/rewizje, which is
                 open to every signed-in reader - so arriving there lights
                 "Rewizje" rather than this menu. -->
            <v-list-item
              v-if="isAdmin"
              :prepend-icon="mdiInboxArrowDown"
              to="/admin/rewizje#kolejka"
              title="Kolejka zmian"
            />
            <v-list-item
              v-if="isAdmin"
              :prepend-icon="mdiNoteEditOutline"
              to="/admin/notatki"
              title="Notatki"
            />
            <!-- Every account, its role and its requests for access. Not for
                 an administrator on trial: the page and its routes refuse
                 them, since a trial is what the page watches. -->
            <v-list-item
              v-if="isEstablishedAdmin"
              :prepend-icon="mdiAccountKeyOutline"
              to="/admin/uzytkownicy"
              title="Użytkownicy"
            />
            <v-list-item
              v-if="isOwner"
              :prepend-icon="mdiSitemapOutline"
              to="/admin/zadania"
              title="Zadania"
            />
            <v-list-item
              v-if="isDatascience"
              :prepend-icon="mdiCogSyncOutline"
              to="/admin/procesy"
              title="Procesy"
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
        <!-- What there is to check and what is wrong, in one place: the QA
             list, its "Problemy" and, for an admin, every report - a problem
             found on /qa is one of those, and an admin's "Problemy" shows it
             as that report; then the two links that leave the site. A menu,
             so there is no QA button with a count on the strip again (a
             standing alarm on every page, taken off on purpose), and so the
             strip keeps one shape on pages with no affine board rather than
             growing a button a tick after the route changes. Lit by hand on
             the pages it lists, as "Admin" is. -->
        <v-menu location="bottom start" content-class="user-toolbar-menu">
          <template #activator="{ props: menu }">
            <v-btn
              v-bind="menu"
              :prepend-icon="mdiAccountGroupOutline"
              :append-icon="mdiChevronDown"
              :active="onTeamPage"
              :aria-current="onTeamPage || undefined"
              variant="text"
            >
              Zespół
            </v-btn>
          </template>
          <v-list density="compact" min-width="220">
            <!-- Exact, query included, so only the tab that is showing is lit:
                 both are /qa to the router. -->
            <v-list-item
              :prepend-icon="mdiClipboardCheckOutline"
              to="/qa"
              exact
              title="QA - zmiany do sprawdzenia"
            />
            <v-list-item
              :prepend-icon="mdiAlertCircleOutline"
              :to="{ path: '/qa', query: { widok: 'problemy' } }"
              exact
              title="Problemy z QA"
            />
            <v-list-item
              v-if="isAdmin"
              :prepend-icon="mdiMessageAlertOutline"
              to="/admin/opinie"
              title="Zgłoszenia"
            />
            <v-divider />
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
    <!-- The claims script changed this account's role while the page was
         open, and the token has been fetched again: the menus above have
         already moved, and this says why. On every page, since the change
         can land on any of them. -->
    <v-snackbar v-model="claimsRefreshed" color="success" :timeout="8000">
      Twoje uprawnienia się zmieniły - menu jest już aktualne.
    </v-snackbar>
    <!-- The same change, but it ended the session: it took a privilege away,
         so the account's sessions were revoked (or the account was disabled),
         and Firebase signed this tab out when it asked for the new token.
         Without this the toolbar would simply vanish mid-page. Longer than the
         one above, because it asks for something - the "Zaloguj się" button
         is already in the bar. -->
    <v-snackbar v-model="claimsSignedOut" color="warning" :timeout="15000">
      Twoje uprawnienia się zmieniły - zaloguj się ponownie.
    </v-snackbar>
  </v-main>
</template>

<script lang="ts" setup>
import {
  mdiAccount,
  mdiAccountGroupOutline,
  mdiAccountKeyOutline,
  mdiAlertCircleOutline,
  mdiChevronDown,
  mdiClipboardCheckOutline,
  mdiCommentTextOutline,
  mdiGithub,
  mdiInboxArrowDown,
  mdiOpenInNew,
  mdiShieldAccount,
  mdiTimelineClockOutline,
  mdiViewList,
  mdiNoteEditOutline,
  mdiMessageAlertOutline,
  mdiSitemapOutline,
  mdiCogSyncOutline,
} from "@mdi/js";
import { computed, ref } from "vue";
import { useAuthState } from "@/composables/auth";
import { useDisplay } from "vuetify";
import { APP_BAR_HEIGHT, useSsrLayoutTop } from "~/composables/appBar";

const ssrLayoutTop = useSsrLayoutTop();
const { mdAndUp } = useDisplay();
const {
  user,
  userConfig,
  logout,
  isAdmin,
  isOwner,
  isDatascience,
  isEstablishedAdmin,
  claimsRefreshed,
  claimsSignedOut,
} = useAuthState();
const route = useRoute();
const loginDialog = ref(false);
const maxWidth = computed(() =>
  route?.meta?.fullWidth ? "none" : (route?.meta?.maxWidth ?? 1200),
);
const rootPadding = computed(() => (route?.meta?.fullWidth ? 0 : undefined));
const affineLink = computed(() => route?.meta?.affineLink);
/** The pages the "Zespół" menu leads to on this site, which light it while it
 * is closed, as "Admin" is lit by hand below. /qa is one page whichever tab is
 * showing; the router serves a path with a trailing slash as the same page. */
const TEAM_PAGES = ["/qa", "/admin/opinie"];
const onTeamPage = computed(() =>
  TEAM_PAGES.includes(route?.path?.replace(/\/+$/, "") ?? ""),
);
/** Whether the page is admin-only, which is what the "Admin" menu stands for
 * while it is closed - the panel's pages without an entry of their own too.
 * Read off the page's middleware rather than its path: /admin/rewizje and a
 * single revision live under /admin but are open to every signed-in reader,
 * and the router serves /admin/notatki/ as the same page as /admin/notatki.
 * `datascience` counts as well: it is /admin/procesy's, whose entry is here.
 * /admin/opinie is admin-only too, but it is listed under "Zespół", which is
 * lit there instead - two buttons lit for one page would say neither. */
const onAdminPage = computed(() => {
  const middleware = [route?.meta?.middleware].flat();
  return (
    (middleware.includes("admin") || middleware.includes("datascience")) &&
    !onTeamPage.value
  );
});
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
