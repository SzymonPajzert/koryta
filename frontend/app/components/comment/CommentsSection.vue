<template>
  <!-- A section of the page like the ones above it: the same 24px head as
       „Notatki” and „Historia powiązań”, with how many comments there are as
       its caption, where „Dyskusja (N)” used to be an h3 of its own among the
       page's h2s. -->
  <PageSection title="Dyskusja" :caption="countCaption">
    <template v-if="!showForm && user" #actions>
      <v-btn
        variant="tonal"
        size="small"
        :prepend-icon="mdiCommentPlusOutline"
        @click="showForm = true"
      >
        Dodaj komentarz
      </v-btn>
    </template>

    <!-- „Sam nawet do końca nie rozumiem jaka jest różnica pomiędzy
         komentarzem i notatka”, from a reader who had just posted a test
         comment. A note is what the site is built from - public, with a
         source, and the thing relations are made out of; this is the talk
         about it. Not on the leads page, which has no notes to point at. -->
    <template v-if="!leadMode" #lead>
      <p class="k-lead" data-testid="comments-lead">
        Pytania i uwagi do innych czytelników - informację ze źródłem zapisz w
        notatce wyżej.
      </p>
    </template>

    <!-- What the section withholds from a reader who is not signed in, said
         in the quiet line a section says that in (`k-absent`), like „Brak
         komentarzy.” below. This line was 12px of #9e9e9e, 2.7:1 on white,
         and prose is never 12px on this site. No margin of its own: `k-note`
         spaces it from a „Brak komentarzy.” under it, as it spaces any two
         such lines. -->
    <div v-if="!user" class="k-note k-absent">
      <router-link to="/login">Zaloguj się</router-link>, aby dodać komentarz.
    </div>

    <div v-if="loading" class="text-center py-4">Ładowanie...</div>

    <div v-if="showForm" class="mb-6">
      <CommentForm
        :node-id="nodeId"
        :edge-id="edgeId"
        @success="handleSuccess"
        @cancel="showForm = false"
      />
    </div>

    <!-- On the head's left edge, as every section's content is, and in the
         one quiet line for what a section lacks (`k-absent`,
         assets/css/type.css). `text-grey` was #9e9e9e at 16px, 2.7:1 on
         white, and read as a control switched off rather than as an empty
         list. -->
    <div v-if="mainComments.length === 0 && !loading" class="k-note k-absent">
      Brak komentarzy.
    </div>

    <div v-else class="comment-list">
      <CommentItem
        v-for="comment in mainComments"
        :key="comment.id"
        :comment="comment"
        :all-comments="comments"
        @reply-success="refresh"
      />
    </div>
  </PageSection>
</template>

<script setup lang="ts">
import { mdiCommentPlusOutline } from "@mdi/js";
import type { Comment } from "~~/shared/model";
import { useAuthState, authFetch } from "@/composables/auth";
import CommentItem from "./CommentItem.vue";
import CommentForm from "./CommentForm.vue";
import PageSection from "../PageSection.vue";
import { polishCounting } from "~/composables/polish";

const props = defineProps<{
  nodeId?: string;
  edgeId?: string;
  leadMode?: boolean;
}>();

const { user } = useAuthState();
const showForm = ref(false);

const query = computed(() => {
  if (props.leadMode) return { onlyLeads: "true" };
  if (props.nodeId) return { nodeId: props.nodeId };
  if (props.edgeId) return { edgeId: props.edgeId };
  return {};
});

const {
  data,
  pending: loading,
  refresh,
} = await authFetch<Comment[]>("/api/comments/list", {
  query,
});

const comments = computed(() => data.value || []);

/** „3 komentarze”, replies included, as the heading's brackets counted them.
 * None at all says itself in the list below („Brak komentarzy.”), so the
 * heading stays bare then rather than saying it twice. */
const countCaption = computed(() =>
  comments.value.length > 0
    ? polishCounting(
        comments.value.length,
        "komentarz",
        "komentarze",
        "komentarzy",
      )
    : undefined,
);
const mainComments = computed(() => {
  if (!Array.isArray(comments.value)) return [];
  return comments.value.filter((c) => !c.parentId);
});

function handleSuccess() {
  showForm.value = false;
  refresh();
}
</script>
