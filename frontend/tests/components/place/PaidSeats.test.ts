import { describe, it, expect, beforeEach } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import PaidSeats from "../../../app/components/place/PaidSeats.vue";
import type { Company } from "../../../shared/model";

// Vuetify's overlay observes resizes, which the test DOM cannot.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;

const REASON =
  "Statut, § 20 ust. 8: „Członkowie Zarządu nie otrzymują wynagrodzenia.” https://pomerania.org.pl/wp-content/uploads/2026/01/Statut_SGPEP_2025.pdf";

async function chip(company: Pick<Company, "paidSeats" | "paidSeatsReason">) {
  return mountSuspended(PaidSeats, { props: { company } });
}

/** The menu is teleported to the body, so it is read from the document. */
const reason = () =>
  document.querySelector<HTMLElement>(
    '[data-testid="company-paid-seats-reason"]',
  );

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("PlacePaidSeats", () => {
  it("says nobody is paid, and opens the reason with its link", async () => {
    const wrapper = await chip({ paidSeats: false, paidSeatsReason: REASON });
    expect(wrapper.text()).toContain("Funkcje bez wynagrodzenia");

    await wrapper.find('[data-testid="company-paid-seats"]').trigger("click");
    await flushPromises();

    expect(reason()?.textContent).toContain("§ 20 ust. 8");
    const link = reason()?.querySelector("a");
    // The host only: a statute's full path would run off a phone.
    expect(link?.textContent).toBe("pomerania.org.pl");
    expect(link?.getAttribute("href")).toBe(
      "https://pomerania.org.pl/wp-content/uploads/2026/01/Statut_SGPEP_2025.pdf",
    );
  });

  it("says the seats are paid where the statute pays", async () => {
    const wrapper = await chip({ paidSeats: true, paidSeatsReason: REASON });
    expect(wrapper.text()).toContain("Funkcje płatne");
  });

  it("says nothing where nobody has answered", async () => {
    const wrapper = await chip({});
    expect(wrapper.find('[data-testid="company-paid-seats"]').exists()).toBe(
      false,
    );
  });

  it("opens no empty menu for an answer without a reason", async () => {
    const wrapper = await chip({ paidSeats: false });
    await wrapper.find('[data-testid="company-paid-seats"]').trigger("click");
    await flushPromises();
    expect(reason()).toBeNull();
  });
});
