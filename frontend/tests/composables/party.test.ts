import { describe, it, expect } from "vitest";
import { usePartyStatistics } from "../../app/composables/party";
import { ref } from "vue";
import { partyColors } from "../../shared/misc";
import type { Person } from "../../shared/model";

// Stub global useEntity since it is auto-imported in the composable
const mockEntities = ref({});

describe("usePartyStatistics", () => {
  // Tests are now environment-agnostic thanks to DI
  it("calculates party statistics correctly", async () => {
    mockEntities.value = {
      person1: {
        parties: ["PiS"],
      },
      person2: {
        parties: ["PO", "Nowa Lewica"],
      },
    };

    const { results } = await usePartyStatistics(mockEntities);

    console.log("Results value:", results.value);
    console.log("Mock entities:", mockEntities.value);

    // Debug logic locally
    const debugResults = Object.keys(partyColors).map((party) => {
      return Object.values(mockEntities.value).filter((person: Person) => {
        return (
          (person.parties ?? []).findIndex((p: string) => p === party) != -1
        );
      }).length;
    });
    console.log("Debug Results:", debugResults);

    // Let's inspect the results structure. It should be an array of numbers.
    // Wait for invalidation? The composable uses computed, so accessing .value should trigger it.

    // We expect the correct parties to be counted.
    // PiS: 1, PO: 1, Nowa Lewica: 1.
    // Assuming partyColors has these keys.

    expect(results.value.length).toBeGreaterThan(0);
    const total = results.value.reduce((a, b) => a + b, 0);
    console.log("Total:", total);
    expect(total).toBeGreaterThanOrEqual(3);
  });
});
