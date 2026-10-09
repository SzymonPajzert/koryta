import { ref } from "vue";
import { authRequest } from "~/composables/auth";
import type {
  Audience,
  CampaignContent,
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

  async function send(id: string, uids: string[]) {
    const answer = await authRequest<{
      outcomes: Record<string, SendOutcome>;
      campaign: CampaignRecord;
    }>("/api/admin/mail/send", { body: { id, uids }, timeout: 120_000 });
    put(answer.campaign);
    await loadDeliveries(id);
    return answer.outcomes;
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
