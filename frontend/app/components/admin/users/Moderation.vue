<template>
  <div class="umod" data-moderation>
    <h3 class="urow-heading">Moderacja</h3>
    <div v-if="options.length" class="d-flex flex-wrap ga-2">
      <v-btn
        v-for="option in options"
        :key="option.action"
        size="small"
        variant="outlined"
        :color="option.color"
        :prepend-icon="option.icon"
        :disabled="busy"
        :data-moderate="option.action"
        @click="ask(option)"
      >
        {{ option.label }}
      </v-btn>
    </div>
    <p v-else class="text-body-2 text-medium-emphasis" data-nothing-to-moderate>
      Nie ma czego moderować: konto nie ma własnego zdjęcia, nazwy ani
      publicznego profilu.
    </p>

    <AdminUsersReasonDialog
      v-model="dialogOpen"
      :title="asked?.title ?? ''"
      :text="asked?.text"
      :confirm-label="asked?.confirm ?? ''"
      :color="asked?.color"
      required
      :limits="MODERATION_REASON"
      :loading="sending"
      @confirm="send"
    />
  </div>
</template>

<script setup lang="ts">
/** What an administrator can take off somebody's account without asking the
 * owner: a picture, a name, a public profile.
 *
 * These exist because the account holder chooses all three, and two of them
 * are shown to anybody - the profile at /uczestnik/<adres> and, through it,
 * the name and picture. Each needs a reason, which goes in the account's
 * history next to who did it. None of them stops the person from choosing a
 * new name or picture; hiding a profile is the one that stays until an
 * administrator undoes it. */
import { computed, ref } from "vue";
import {
  mdiAccountOffOutline,
  mdiAccountReactivateOutline,
  mdiImageRemoveOutline,
  mdiRenameOutline,
} from "@mdi/js";
import {
  MODERATION_REASON,
  profilePath,
  type AdminUserRow,
  type ModerationAction,
} from "~~/shared/userAdmin";

const props = defineProps<{
  row: AdminUserRow;
  busy?: boolean;
  /** Sends one action; resolves to whether it went through. */
  moderate: (action: ModerationAction, reason: string) => Promise<boolean>;
}>();

type Option = {
  action: ModerationAction;
  label: string;
  icon: string;
  color?: string;
  title: string;
  text: string;
  confirm: string;
};

/** A picture the site stores for the account, rather than the one the sign-in
 * provider hands over. Only that one can be removed: a Google photo is
 * Google's, and the account would get it back at the next sign-in. */
const ownAvatar = computed(
  () => !!props.row.photoURL?.includes("/api/images/"),
);

/** How the dialogs name the profile: by its address where it has one. */
const profileName = computed(() =>
  props.row.profile.handle
    ? `Profil ${profilePath(props.row.profile.handle)}`
    : "Publiczny profil",
);

const options = computed(() => {
  const list: Option[] = [];
  if (ownAvatar.value) {
    list.push({
      action: "removeAvatar",
      label: "Usuń zdjęcie profilowe",
      icon: mdiImageRemoveOutline,
      color: "ink-danger",
      title: "Usunąć zdjęcie profilowe?",
      text:
        "Konto wróci do zdjęcia od dostawcy logowania albo do inicjałów. " +
        "Właściciel konta może dodać nowe.",
      confirm: "Usuń zdjęcie",
    });
  }
  if (props.row.displayName) {
    list.push({
      action: "resetName",
      label: "Usuń nazwę",
      icon: mdiRenameOutline,
      color: "ink-danger",
      title: "Usunąć nazwę użytkownika?",
      text:
        `Nazwa „${props.row.displayName}” zniknie z konta, a w historii ` +
        "zostanie zapisana. Właściciel konta może ustawić nową na /profil.",
      confirm: "Usuń nazwę",
    });
  }
  if (props.row.profile.hidden) {
    list.push({
      action: "unhideProfile",
      label: "Przywróć profil",
      icon: mdiAccountReactivateOutline,
      title: "Przywrócić profil?",
      text:
        `${profileName.value} znów będzie się otwierać, ` +
        "jeśli właściciel konta ma włączony publiczny profil.",
      confirm: "Przywróć",
    });
  } else if (props.row.profile.public || props.row.profile.handle) {
    list.push({
      action: "hideProfile",
      label: "Ukryj profil",
      icon: mdiAccountOffOutline,
      color: "ink-danger",
      title: "Ukryć profil?",
      text:
        `${profileName.value} przestanie się otwierać, dopóki administrator ` +
        "go nie przywróci. Ustawienie na /profil zostaje, jak jest.",
      confirm: "Ukryj profil",
    });
  }
  return list;
});

const asked = ref<Option | null>(null);
const dialogOpen = ref(false);
const sending = ref(false);

function ask(option: Option) {
  asked.value = option;
  dialogOpen.value = true;
}

async function send(reason: string) {
  if (!asked.value) return;
  sending.value = true;
  try {
    if (await props.moderate(asked.value.action, reason)) {
      dialogOpen.value = false;
    }
  } finally {
    sending.value = false;
  }
}
</script>
