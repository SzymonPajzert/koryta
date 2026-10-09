<template>
  <div class="mailing-page w-100">
    <h1 class="text-h5 text-sm-h4 mb-2">Mailing</h1>
    <p class="text-body-2 text-medium-emphasis mb-4">
      Kampanie do osób z kontem. Admini dostają je jako wiadomość dla zespołu,
      pozostali tylko wtedy, gdy zapisali się na temat kampanii - w profilu albo
      w okienku, które pokazujemy zalogowanym. Każda osoba dostaje jedną
      kampanię najwyżej raz, więc można ją najpierw wysłać na próbę, poprawić, a
      dopiero potem rozesłać szerzej.
    </p>

    <v-alert v-if="loadError" type="error" variant="tonal" class="mb-4">
      {{ loadError }}
    </v-alert>
    <v-progress-linear v-if="pending" indeterminate class="mb-4" />

    <div class="d-flex align-center flex-wrap ga-2 mb-4">
      <v-select
        :model-value="selectedId"
        :items="campaignItems"
        item-title="title"
        item-value="id"
        label="Kampania"
        placeholder="Nowa, jeszcze niezapisana"
        persistent-placeholder
        density="compact"
        variant="outlined"
        hide-details
        class="mailing-page__picker"
        data-campaign-picker
        @update:model-value="openCampaign"
      />
      <v-btn
        :prepend-icon="mdiPlus"
        variant="tonal"
        data-campaign-new
        @click="openCampaign(null)"
      >
        Nowa kampania
      </v-btn>
    </div>

    <v-row>
      <v-col cols="12" md="6">
        <v-card rounded="lg" class="mb-4">
          <v-card-title>Treść</v-card-title>
          <v-card-text>
            <v-text-field
              v-model="form.subject"
              label="Temat wiadomości"
              :counter="campaignLimits.subject"
              data-campaign-subject
            />
            <v-select
              v-model="form.topic"
              :items="topicItems"
              label="Temat zgody"
              hint="Poza zespołem kampania dojdzie tylko do osób zapisanych na ten temat"
              persistent-hint
              class="mb-2"
              data-campaign-topic
            />
            <v-textarea
              v-model="form.body"
              label="Treść"
              auto-grow
              rows="8"
              :counter="campaignLimits.body"
              hint="Akapity oddzielaj pustą linią. Link: [tekst](/sciezka) albo [tekst](https://…)"
              persistent-hint
              class="mb-2"
              data-campaign-body
            />
            <div class="d-flex flex-wrap ga-2">
              <v-text-field
                v-model="form.ctaLabel"
                label="Napis na przycisku"
                :counter="campaignLimits.ctaLabel"
                class="mailing-page__cta"
                data-campaign-cta-label
              />
              <v-text-field
                v-model="form.ctaPath"
                label="Link przycisku"
                placeholder="/eksploruj/nowe"
                class="mailing-page__cta"
                data-campaign-cta-path
              />
            </div>
            <v-switch
              v-model="form.includeStats"
              color="primary"
              label="Dodaj liczby"
              :hint="`Wkład odbiorcy z ostatnich ${CAMPAIGN_STATS_DAYS} dni, jeśli jakiś był, i co działo się w serwisie przez ostatnie ${COMMUNITY_STATS_DAYS}`"
              persistent-hint
              data-campaign-stats
            />
          </v-card-text>
          <v-card-actions class="px-4 pb-4 flex-wrap ga-2">
            <v-btn
              color="ink-sage"
              variant="flat"
              :loading="busy === 'save'"
              :disabled="busy !== null || (!dirty && !!selectedId)"
              data-campaign-save
              @click="saveDraft"
            >
              {{ selectedId ? "Zapisz zmiany" : "Zapisz szkic" }}
            </v-btn>
            <v-btn
              variant="tonal"
              :prepend-icon="mdiEmailCheckOutline"
              :loading="busy === 'test'"
              :disabled="busy !== null"
              data-campaign-test
              @click="test"
            >
              Wyślij test do mnie
            </v-btn>
            <span v-if="dirty" class="text-caption text-medium-emphasis">
              Niezapisane zmiany
            </span>
          </v-card-actions>
        </v-card>
      </v-col>

      <v-col cols="12" md="6">
        <v-card rounded="lg" class="mb-4">
          <v-card-title>Podgląd</v-card-title>
          <v-card-text>
            <v-select
              v-model="previewUid"
              :items="previewItems"
              item-title="title"
              item-value="uid"
              label="Tak, jak zobaczy"
              density="compact"
              variant="outlined"
              hide-details
              class="mb-3"
              data-campaign-preview-as
            />
            <div class="text-body-2 mb-2" data-campaign-preview-subject>
              <strong>Temat:</strong> {{ preview.mail?.subject || "—" }}
            </div>
            <v-btn-toggle
              v-model="previewFormat"
              density="compact"
              variant="outlined"
              divided
              mandatory
              class="mb-2"
            >
              <v-btn value="html">Wiadomość</v-btn>
              <v-btn value="text">Sam tekst</v-btn>
            </v-btn-toggle>
            <v-alert
              v-if="preview.error"
              type="error"
              variant="tonal"
              density="compact"
            >
              {{ preview.error }}
            </v-alert>
            <!-- Sandboxed with no scripts; links open in a new tab, which is
                 what the base target in the document asks for. -->
            <iframe
              v-else-if="previewFormat === 'html'"
              :srcdoc="previewDocument"
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              title="Podgląd wiadomości"
              class="mailing-page__preview"
              data-campaign-preview
            />
            <pre v-else class="mailing-page__text">{{
              preview.mail?.text
            }}</pre>
            <div v-if="links.length > 0" class="mt-3 text-body-2">
              <div class="font-weight-medium mb-1">
                Linki w wiadomości - otwórz każdy przed wysłaniem
              </div>
              <ul class="ml-4">
                <li v-for="link in links" :key="link">
                  <a :href="link" target="_blank" rel="noopener">{{ link }}</a>
                </li>
              </ul>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-card rounded="lg" class="mb-4">
      <v-card-title>Odbiorcy</v-card-title>
      <v-card-text>
        <div class="d-flex align-center flex-wrap ga-2 mb-2">
          <v-chip-group
            :model-value="preset"
            selected-class="text-ink-sage"
            @update:model-value="applyPreset"
          >
            <v-chip
              v-for="choice in audiencePresets"
              :key="choice"
              :value="choice"
              size="small"
              filter
              :data-preset="choice"
            >
              {{ audiencePresetLabels[choice] }}
            </v-chip>
          </v-chip-group>
          <v-spacer />
          <v-text-field
            v-model="search"
            placeholder="Szukaj osoby"
            :prepend-inner-icon="mdiMagnify"
            density="compact"
            variant="outlined"
            hide-details
            clearable
            class="mailing-page__search"
          />
        </div>
        <p class="text-body-2 mb-1" data-audience-summary>
          Zaznaczone: {{ selected.length }} · Mogą ją dostać:
          {{ selectableCount
          }}<template v-if="receivedCount > 0">
            · Już ją mają: {{ receivedCount }}</template
          >
        </p>
        <p
          v-if="ineligibleSummary"
          class="text-body-2 text-medium-emphasis mb-3"
        >
          Nie dostaną jej: {{ ineligibleSummary }}.
        </p>
        <v-data-table
          v-model="selected"
          show-select
          item-value="uid"
          item-selectable="selectable"
          :headers="headers"
          :items="filteredRows"
          :loading="pending"
          density="compact"
          :items-per-page="-1"
          hide-default-footer
          no-data-text="Nikogo tu nie ma."
          loading-text="Ładowanie..."
          data-audience-table
        >
          <template #[`item.name`]="{ item }">
            <div class="py-1" :data-audience-row="item.uid">
              <div class="font-weight-medium">{{ item.name }}</div>
              <div
                v-if="item.email && item.email !== item.name"
                class="text-caption text-medium-emphasis"
              >
                {{ item.email }}
              </div>
            </div>
          </template>
          <template #[`item.roles`]="{ item }">
            <v-chip
              v-if="item.owner"
              size="x-small"
              class="mr-1"
              color="ink-sage"
            >
              Właściciel
            </v-chip>
            <v-chip v-else-if="item.newAdmin" size="x-small" class="mr-1">
              Admin na próbę
            </v-chip>
            <v-chip v-else-if="item.admin" size="x-small" class="mr-1">
              Admin
            </v-chip>
          </template>
          <template #[`item.lastSeenAt`]="{ item }">
            {{ formatDaysAgo(item.lastSeenAt) }}
          </template>
          <template #[`item.consent`]="{ item }">
            <span
              :class="item.eligibility.eligible ? '' : 'text-medium-emphasis'"
            >
              {{ consentLabel(item) }}
            </span>
          </template>
          <template #[`item.delivery`]="{ item }">
            <template v-if="item.delivery">
              <span :class="deliveryClass(item.delivery.state)">
                {{ deliveryStateLabels[item.delivery.state] }}
              </span>
              <div
                v-if="item.delivery.error"
                class="text-caption text-ink-danger"
              >
                {{ item.delivery.error }}
              </div>
              <div v-if="item.returned" class="text-caption">
                Na stronie po wysyłce
              </div>
            </template>
            <span v-else class="text-medium-emphasis">—</span>
          </template>
        </v-data-table>
      </v-card-text>
      <v-card-actions class="px-4 pb-4 flex-wrap ga-2">
        <v-btn
          color="ink-sage"
          variant="flat"
          :prepend-icon="mdiSend"
          :disabled="busy !== null || selected.length === 0"
          :loading="busy === 'send'"
          data-campaign-send
          @click="confirmOpen = true"
        >
          Wyślij do
          {{ polishCountingGenitive(selected.length, "osoby", "osób") }}
        </v-btn>
        <span v-if="dirty" class="text-caption text-medium-emphasis">
          Zmiany w treści zapiszą się przed wysyłką.
        </span>
      </v-card-actions>
    </v-card>

    <v-card v-if="current" rounded="lg" class="mb-4" data-campaign-results>
      <v-card-title>Wyniki</v-card-title>
      <v-card-text>
        <div class="d-flex flex-wrap ga-6 mb-3">
          <div v-for="tile in resultTiles" :key="tile.label">
            <div class="text-h6" :data-result="tile.key">{{ tile.value }}</div>
            <div class="text-caption text-medium-emphasis">
              {{ tile.label }}
            </div>
          </div>
        </div>
        <p class="text-caption text-medium-emphasis mb-3">
          „W kolejce” znaczy, że rozszerzenie Trigger Email jeszcze nie wzięło
          wiadomości - dopóki nie jest zainstalowane, tak zostaje. „Na stronie
          po wysyłce” liczy każde wejście zalogowanej osoby, także otwartą
          wcześniej kartę. Wizyty z linków w wiadomości są w Plausible pod UTM
          Campaign „{{ current.id }}”.
        </p>
        <v-table v-if="history.length > 0" density="compact">
          <thead>
            <tr>
              <th>Kiedy</th>
              <th>Co</th>
              <th>Wynik</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in history" :key="entry.at">
              <td class="text-no-wrap">{{ formatTaskDate(entry.at) }}</td>
              <td>{{ entry.test ? "Test do siebie" : "Wysyłka" }}</td>
              <td>{{ outcomeSummary(entry.outcomes) }}</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
    </v-card>

    <v-dialog v-model="confirmOpen" max-width="480">
      <v-card>
        <v-card-title class="text-wrap">
          Wysłać „{{ form.subject }}”?
        </v-card-title>
        <v-card-text>
          Kampania pójdzie do
          {{ polishCountingGenitive(selected.length, "osoby", "osób") }}. Każda
          dostanie ją raz: wysłanie jej później do kolejnych osób pominie te,
          które już ją mają. Wysłanej wiadomości nie da się cofnąć.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="confirmOpen = false">Anuluj</v-btn>
          <v-btn
            color="ink-sage"
            variant="flat"
            data-campaign-send-confirm
            @click="sendNow"
          >
            Wyślij
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar" :color="snackbarColor" timeout="8000">
      {{ snackbarText }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { mdiEmailCheckOutline, mdiMagnify, mdiPlus, mdiSend } from "@mdi/js";
import { useAuthState } from "@/composables/auth";
import { mailingError, useMailing } from "~/composables/mailing";
import { polishCountingGenitive } from "~/composables/polish";
import { formatDaysAgo } from "~/utils/chartTheme";
import { formatTaskDate } from "~/utils/taskStyle";
import {
  CAMPAIGN_STATS_DAYS,
  COMMUNITY_STATS_DAYS,
  audiencePresetLabels,
  audiencePresets,
  campaignEligibility,
  campaignLimits,
  campaignLinks,
  campaignTopicLabels,
  campaignTopics,
  deliveryStateLabels,
  ineligibleLabels,
  presetIncludes,
  renderCampaign,
  sendOutcomeLabels,
  unsubscribeUrls,
  type AudienceMember,
  type AudiencePreset,
  type CampaignContent,
  type CampaignMail,
  type CampaignRecord,
  type Delivery,
  type DeliveryState,
  type Eligibility,
  type IneligibleReason,
  type SendOutcome,
} from "~~/shared/campaigns";

definePageMeta({
  // `admin` as well, though every owner is one: it is what lights the Admin
  // menu while the page is open.
  middleware: ["admin", "owner"],
});

useHead({ title: "Mailing (Admin) - koryta.pl" });

const route = useRoute();
const router = useRouter();
const { user } = useAuthState();
const {
  audience,
  campaigns,
  deliveries,
  pending,
  loadError,
  load,
  loadDeliveries,
  save,
  sendTest,
  send,
} = useMailing();

/** Where the links in a message point: the deployment's own address, so a
 * campaign written on autopush links to autopush. */
const siteUrl = String(useRuntimeConfig().public.siteUrl);

/** What a new campaign starts as - the pilot's text, to be edited. */
const DRAFT: CampaignContent = {
  subject: "Pomożesz sprawdzić kilka osób?",
  body: [
    "Cześć,",
    "to pierwsza wiadomość, którą koryta.pl wysyła do osób z kontem. Na początek piszemy do zespołu i do osób, które zaglądały do nas w ostatnich tygodniach - jeśli coś w niej nie działa, po prostu odpisz.",
    "W kolejce czekają osoby, których nikt jeszcze nie sprawdził. Jedno sprawdzenie to kilka minut: otwierasz stronę osoby, patrzysz na źródła i oceniasz, czy to dobre znalezisko.",
    "Dziękujemy, że jesteś z nami!\nZespół koryta.pl",
  ].join("\n\n"),
  ctaLabel: "Sprawdź kolejną osobę",
  ctaPath: "/eksploruj/nowe",
  topic: "callsToAction",
  includeStats: true,
};

const contentOf = (content: CampaignContent): CampaignContent => ({
  subject: content.subject,
  body: content.body,
  ctaLabel: content.ctaLabel,
  ctaPath: content.ctaPath,
  topic: content.topic,
  includeStats: content.includeStats,
});

const selectedId = ref<string | null>(null);
const form = reactive<CampaignContent>({ ...DRAFT });
const current = computed<CampaignRecord | null>(
  () => campaigns.value.find((c) => c.id === selectedId.value) ?? null,
);
const dirty = computed(
  () =>
    !current.value ||
    JSON.stringify(contentOf(form)) !==
      JSON.stringify(contentOf(current.value)),
);

const campaignItems = computed(() =>
  campaigns.value.map((c) => ({
    id: c.id,
    title: `${c.subject} · ${c.recipients.length > 0 ? `wysłana do ${c.recipients.length}` : "szkic"}`,
  })),
);
const topicItems = campaignTopics.map((topic) => ({
  value: topic,
  title: campaignTopicLabels[topic].title,
}));

const snackbar = ref(false);
const snackbarText = ref("");
const snackbarColor = ref<"success" | "error">("success");
const notify = (text: string, color: "success" | "error" = "success") => {
  snackbarText.value = text;
  snackbarColor.value = color;
  snackbar.value = true;
};

/** Opens a stored campaign, or a fresh draft for null. Picking is the only
 * thing that resets the form and the selection; saving keeps both. */
async function openCampaign(id: string | null) {
  selectedId.value = id;
  const campaign = campaigns.value.find((c) => c.id === id);
  Object.assign(form, campaign ? contentOf(campaign) : DRAFT);
  selected.value = [];
  preset.value = null;
  void router.replace({ query: { ...route.query, kampania: id ?? undefined } });
  try {
    await loadDeliveries(id);
  } catch (error) {
    notify(`Nie udało się wczytać wysyłek: ${mailingError(error)}`, "error");
  }
}

onMounted(async () => {
  await load();
  const asked = route.query.kampania;
  const known = campaigns.value.some((c) => c.id === asked);
  await openCampaign(
    typeof asked === "string" && known
      ? asked
      : (campaigns.value[0]?.id ?? null),
  );
});

// --- preview -----------------------------------------------------------

const members = computed<AudienceMember[]>(() => audience.value?.members ?? []);
const previewUid = ref<string | null>(null);
watch(
  [members, () => user.value?.uid],
  () => {
    if (
      previewUid.value &&
      members.value.some((m) => m.uid === previewUid.value)
    ) {
      return;
    }
    previewUid.value =
      members.value.find((m) => m.uid === user.value?.uid)?.uid ??
      members.value[0]?.uid ??
      null;
  },
  { immediate: true },
);
const previewItems = computed(() =>
  members.value.map((m) => ({
    uid: m.uid,
    title: m.displayName || m.email || m.uid,
  })),
);
const previewFormat = ref<"html" | "text">("html");

/** The message the previewed person would get, rendered by the same function
 * the server sends with. Only the token in the unsubscribe link differs. */
const preview = computed<{ mail: CampaignMail | null; error: string | null }>(
  () => {
    const member = members.value.find((m) => m.uid === previewUid.value);
    const eligibility = member ? campaignEligibility(member, form.topic) : null;
    try {
      const mail = renderCampaign({
        campaignId: selectedId.value ?? "nowa-kampania",
        content: form,
        via: eligibility?.eligible ? eligibility.via : "team",
        personal: member
          ? {
              days: CAMPAIGN_STATS_DAYS,
              counts: member.activity.counts,
              total: member.activity.total,
            }
          : null,
        community: audience.value?.community ?? null,
        siteUrl,
        unsubscribe: unsubscribeUrls(siteUrl, {
          uid: member?.uid ?? "uid",
          token: "podglad",
          topic: form.topic,
          campaignId: selectedId.value ?? undefined,
        }),
      });
      return { mail, error: null };
    } catch (error) {
      return {
        mail: null,
        error: `Podgląd nie działa: ${mailingError(error)}`,
      };
    }
  },
);
const previewDocument = computed(
  () =>
    `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"></head><body style="margin: 16px;">${preview.value.mail?.html ?? ""}</body></html>`,
);
const links = computed(() =>
  campaignLinks(form).map((path) => `${siteUrl.replace(/\/$/, "")}${path}`),
);

// --- audience ----------------------------------------------------------

type Row = AudienceMember & {
  name: string;
  activityTotal: number;
  eligibility: Eligibility;
  received: boolean;
  delivery: Delivery | null;
  /** Seen on the site after this campaign's message was queued for them. */
  returned: boolean;
  selectable: boolean;
};

const rows = computed<Row[]>(() =>
  members.value.map((member) => {
    const eligibility = campaignEligibility(member, form.topic);
    const received = current.value?.recipients.includes(member.uid) ?? false;
    const delivery = deliveries.value[member.uid] ?? null;
    return {
      ...member,
      name: member.displayName || member.email || member.uid,
      activityTotal: member.activity.total,
      eligibility,
      received,
      delivery,
      returned:
        !!delivery?.queuedAt &&
        !!member.lastSeenAt &&
        member.lastSeenAt > delivery.queuedAt,
      selectable: eligibility.eligible && !received,
    };
  }),
);

const search = ref<string | null>("");
const filteredRows = computed(() => {
  const needle = (search.value ?? "").trim().toLowerCase();
  if (!needle) return rows.value;
  return rows.value.filter((row) =>
    `${row.name} ${row.email ?? ""}`.toLowerCase().includes(needle),
  );
});

const selected = ref<string[]>([]);
const preset = ref<AudiencePreset | null>(null);

function applyPreset(value: AudiencePreset | null) {
  preset.value = value;
  const now = new Date();
  selected.value = value
    ? rows.value
        .filter((row) => row.selectable && presetIncludes(value, row, now))
        .map((row) => row.uid)
    : [];
}

// A topic change can make somebody ineligible; never keep them ticked.
watch(rows, () => {
  const selectable = new Set(
    rows.value.filter((row) => row.selectable).map((row) => row.uid),
  );
  const kept = selected.value.filter((uid) => selectable.has(uid));
  if (kept.length !== selected.value.length) selected.value = kept;
});

const selectableCount = computed(
  () => rows.value.filter((row) => row.selectable).length,
);
const receivedCount = computed(
  () => rows.value.filter((row) => row.received).length,
);
const ineligibleSummary = computed(() => {
  const counts = new Map<IneligibleReason, number>();
  for (const row of rows.value) {
    if (!row.eligibility.eligible) {
      const reason = row.eligibility.reason;
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(
      ([reason, count]) =>
        `${ineligibleLabels[reason].toLowerCase()} - ${count}`,
    )
    .join(", ");
});

const headers = [
  { title: "Osoba", key: "name" },
  { title: "Rola", key: "roles", sortable: false },
  { title: "Ostatnio", key: "lastSeenAt" },
  { title: `Wkład (${CAMPAIGN_STATS_DAYS} dni)`, key: "activityTotal" },
  { title: "Zgoda", key: "consent", sortable: false },
  { title: "Ta kampania", key: "delivery", sortable: false },
];

function consentLabel(row: Row): string {
  if (!row.eligibility.eligible)
    return ineligibleLabels[row.eligibility.reason];
  return row.eligibility.via === "team"
    ? "Zespół"
    : `Zapisany temat: ${campaignTopicLabels[form.topic].title}`;
}

function deliveryClass(state: DeliveryState): string {
  if (state === "SUCCESS") return "text-ink-success";
  if (state === "ERROR") return "text-ink-danger";
  return "text-medium-emphasis";
}

// --- results -----------------------------------------------------------

const resultTiles = computed(() => {
  const states = Object.values(deliveries.value).map((d) => d.state);
  const waiting: DeliveryState[] = ["queued", "PENDING", "PROCESSING", "RETRY"];
  return [
    {
      key: "recipients",
      label: "odbiorców",
      value: current.value?.recipients.length ?? 0,
    },
    {
      key: "waiting",
      label: "w kolejce",
      value: states.filter((s) => waiting.includes(s)).length,
    },
    {
      key: "sent",
      label: "wysłano",
      value: states.filter((s) => s === "SUCCESS").length,
    },
    {
      key: "failed",
      label: "błędów",
      value: states.filter((s) => s === "ERROR").length,
    },
    {
      key: "returned",
      label: "na stronie po wysyłce",
      value: rows.value.filter((r) => r.received && r.returned).length,
    },
    {
      key: "unsubscribed",
      label: "wypisań",
      value: current.value?.unsubscribed.length ?? 0,
    },
  ];
});

const history = computed(() => [...(current.value?.sends ?? [])].reverse());

function outcomeSummary(
  outcomes: Partial<Record<SendOutcome, number>>,
): string {
  return (Object.entries(outcomes) as [SendOutcome, number][])
    .map(([outcome, count]) => `${sendOutcomeLabels[outcome]}: ${count}`)
    .join(" · ");
}

// --- actions -----------------------------------------------------------

const busy = ref<"save" | "test" | "send" | null>(null);
const confirmOpen = ref(false);

/** The open campaign as stored, saving the form first if it changed - so
 * what is tested or sent is always what the page shows. */
async function persist(): Promise<CampaignRecord> {
  if (current.value && !dirty.value) return current.value;
  const saved = await save(selectedId.value, contentOf(form));
  if (selectedId.value !== saved.id) {
    selectedId.value = saved.id;
    void router.replace({ query: { ...route.query, kampania: saved.id } });
  }
  return saved;
}

async function saveDraft() {
  busy.value = "save";
  try {
    await persist();
    notify("Zapisano.");
  } catch (error) {
    notify(`Nie udało się zapisać: ${mailingError(error)}`, "error");
  } finally {
    busy.value = null;
  }
}

async function test() {
  busy.value = "test";
  try {
    const campaign = await persist();
    const outcome = await sendTest(campaign.id);
    if (outcome === "queued") {
      notify(`Test poszedł na ${user.value?.email ?? "Twój adres"}.`);
    } else {
      notify(`Test nie poszedł: ${sendOutcomeLabels[outcome]}.`, "error");
    }
  } catch (error) {
    notify(`Nie udało się wysłać testu: ${mailingError(error)}`, "error");
  } finally {
    busy.value = null;
  }
}

async function sendNow() {
  confirmOpen.value = false;
  busy.value = "send";
  try {
    const campaign = await persist();
    const outcomes = await send(campaign.id, selected.value);
    const values = Object.values(outcomes);
    const queued = values.filter((o) => o === "queued").length;
    const skipped = values.length - queued;
    notify(
      skipped > 0
        ? `Wysłano do kolejki: ${queued}. Pominięto: ${skipped} - szczegóły w wynikach.`
        : `Wysłano do kolejki: ${queued}.`,
      skipped > 0 && queued === 0 ? "error" : "success",
    );
    selected.value = [];
    preset.value = null;
  } catch (error) {
    notify(`Nie udało się wysłać: ${mailingError(error)}`, "error");
  } finally {
    busy.value = null;
  }
}
</script>

<style scoped>
.mailing-page__picker {
  min-width: 260px;
  max-width: 560px;
}

.mailing-page__search {
  max-width: 260px;
}

.mailing-page__cta {
  min-width: 200px;
}

.mailing-page__preview {
  width: 100%;
  height: 520px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 8px;
  background: #fff;
}

.mailing-page__text {
  white-space: pre-wrap;
  font-size: 13px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 8px;
  padding: 12px;
  max-height: 520px;
  overflow: auto;
}
</style>
