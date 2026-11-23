import { describe, it, expect } from "vitest";
import { hiddenTargetCount } from "../../app/utils/hiddenTargets";

describe("hiddenTargetCount", () => {
  it("does not count the województwo markers as hidden ties", () => {
    // A hidden run in Kraków gives `all` a region and its marker; only the
    // region is a hidden tie.
    expect(
      hiddenTargetCount({
        edges: {
          all: {
            targetNodeIds: ["teryt1465", "teryt1261", "woj:14", "woj:12"],
          },
          approved: { targetNodeIds: ["teryt1465", "woj:14"] },
        },
      }),
    ).toBe(1);
  });

  it("takes the count the server worked out when it is there", () => {
    expect(hiddenTargetCount({ edges: { hiddenTargets: 3 } })).toBe(3);
  });
});
