import { ref } from "vue";
import { authRequest } from "~/composables/auth";
import { nominativeNoun, polishCountingGenitive } from "~/composables/polish";
import { CAMPAIGN_BATCH_SIZE } from "~~/shared/campaignPacing";
import type {
  Audience,
  CampaignContent,
  CampaignQueue,
  CampaignRecord,
  Delivery,
  SendOutcome,
} from "~~/shared/campaigns";

/** What the server said went wrong, in its own words where it gave some. */
export function mailingError(error: unknown): string {
  const data = (error as { data?: { message?: string } } | null)?.data;
  if (data?.message) return data.message;
  return error instanceof Error ? error.message : String(error);
}

/** Where a reader stands with the open campaign. `failed`: it was sent and
 * the delivery failed. `received`: they have it, or it is on its way to them,
 * so a send skips them. A failed message never arrived and a withdrawn one
 * never went, and a send writes either afresh (queueOne in
 * server/utils/mailCampaigns.ts), so neither counts as received. */
export function campaignStanding(
  delivery: Delivery | null,
  isRecipient: boolean,
): { failed: boolean; received: boolean } {
  const failed = delivery?.state === "ERROR";
  const neverArrived = failed || delivery?.state === "WITHDRAWN";
  return { failed, received: isRecipient && !neverArrived };
}

/** The confirmation's first sentence: how many people a send goes to, and
 * how many of them get it again after a failed delivery. */
export function campaignSendQuestion(count: number, retries: number): string {
  const people = polishCountingGenitive(count, "osoby", "osób");
  if (count > 0 && retries === count) {
    return `Kampania pójdzie ponownie do ${people}, po błędzie wysyłki.`;
  }
  if (retries > 0) {
    return `Kampania pójdzie do ${people} (do ${retries} z nich ponownie, po błędzie wysyłki).`;
  }
  return `Kampania pójdzie do ${people}.`;
}

/** When the mail that waits goes out: within minutes, or from tomorrow once
 * the day's allowance is spent. `queue.waiting` counts every campaign's held
 * mail, so where more waits than this send queued, the note says how much. */
function paceNote(queue: CampaignQueue, queuedNow: number): string {
  if (queue.waiting === 0) return "";
  if (queue.waiting <= queue.leftToday) {
    return `Wychodzą po ${CAMPAIGN_BATCH_SIZE} na minutę.`;
  }
  const waiting =
    queue.waiting === queuedNow ? "" : `W kolejce: ${queue.waiting}. `;
  if (queue.leftToday === 0) {
    return `${waiting}Dzisiejszy limit jest już wykorzystany, wysyłka ruszy jutro.`;
  }
  const go = nominativeNoun(queue.leftToday, "wyjdzie", "wyjdą", "wyjdzie");
  return `${waiting}Dziś ${go} jeszcze ${queue.leftToday}, reszta od jutra.`;
}

/** What the page says once a send is done: how many were queued, how many
 * of them again after a failed delivery, how many were skipped, and when what
 * waits goes out. Red only when nobody was queued. */
export function campaignSendNotice(
  outcomes: Record<string, SendOutcome>,
  queue: CampaignQueue,
): { text: string; color: "success" | "error" } {
  const values = Object.values(outcomes);
  const requeued = values.filter((o) => o === "requeued").length;
  const queued = values.filter((o) => o === "queued").length + requeued;
  const skipped = values.length - queued;
  const sent =
    requeued > 0 && requeued === queued
      ? `Ponownie do kolejki: ${queued}.`
      : `Wysłano do kolejki: ${queued}${requeued > 0 ? `, w tym ponownie: ${requeued}` : ""}.`;
  return {
    text: [
      sent,
      skipped > 0 ? `Pominięto: ${skipped} - szczegóły w wynikach.` : "",
      queued > 0 ? paceNote(queue, queued) : "",
    ]
      .filter(Boolean)
      .join(" "),
    color: skipped > 0 && queued === 0 ? "error" : "success",
  };
}

/** The owner's campaigns for /admin/mailing: who could get one, what each
 * says, and how far the messages of the open one have got. Every write puts
 * back what the server wrote, so the page never shows a send that did not
 * happen. */
export function useMailing() {
  const audience = ref<Audience | null>(null);
  const campaigns = ref<CampaignRecord[]>([]);
  const deliveries = ref<Record<string, Delivery>>({});
  const pending = ref(true);
  const loadError = ref("");

  const put = (campaign: CampaignRecord) => {
    const index = campaigns.value.findIndex((c) => c.id === campaign.id);
    if (index >= 0) campaigns.value.splice(index, 1, campaign);
    else campaigns.value.unshift(campaign);
    return campaign;
  };

  async function load() {
    pending.value = true;
    loadError.value = "";
    try {
      const [people, list] = await Promise.all([
        authRequest<Audience>("/api/admin/mail/audience", { method: "GET" }),
        authRequest<{ campaigns: CampaignRecord[] }>(
          "/api/admin/mail/campaigns",
          { method: "GET" },
        ),
      ]);
      audience.value = people;
      campaigns.value = list.campaigns;
    } catch (error) {
      loadError.value = `Nie udało się wczytać danych: ${mailingError(error)}`;
    } finally {
      pending.value = false;
    }
  }

  async function loadDeliveries(id: string | null) {
    if (!id) {
      deliveries.value = {};
      return;
    }
    const answer = await authRequest<{ deliveries: Record<string, Delivery> }>(
      "/api/admin/mail/deliveries",
      { method: "GET", query: { id } },
    );
    deliveries.value = answer.deliveries;
  }

  async function save(id: string | null, content: CampaignContent) {
    const answer = await authRequest<{ campaign: CampaignRecord }>(
      "/api/admin/mail/save",
      { body: { ...(id ? { id } : {}), content } },
    );
    return put(answer.campaign);
  }

  async function sendTest(id: string) {
    const answer = await authRequest<{
      outcome: SendOutcome;
      campaign: CampaignRecord;
    }>("/api/admin/mail/test", { body: { id } });
    put(answer.campaign);
    return answer.outcome;
  }

  /** What became of each picked person, and how much mail now waits for its
   * batch. */
  async function send(id: string, uids: string[]) {
    const answer = await authRequest<{
      outcomes: Record<string, SendOutcome>;
      campaign: CampaignRecord;
      queue: CampaignQueue;
    }>("/api/admin/mail/send", { body: { id, uids }, timeout: 120_000 });
    put(answer.campaign);
    await loadDeliveries(id);
    return { outcomes: answer.outcomes, queue: answer.queue };
  }

  return {
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
  };
}
