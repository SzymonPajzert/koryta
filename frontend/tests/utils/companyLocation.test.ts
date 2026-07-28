import { describe, it, expect } from "vitest";
import { regionNamesByPlaceId } from "~/utils/companyLocation";
import type { Region } from "~~/shared/model";

function region(
  name: string,
  teryt: string,
  targets: { all?: string[]; approved?: string[] },
): Region {
  return {
    name,
    type: "region",
    teryt,
    stats: {
      isApproved: true,
      notesCount: 0,
      votes: {},
      edges: {
        all: {
          experienceMonths: 0,
          latestEmploymentStart: null,
          targetNodeIds: targets.all ?? [],
          currentlyEmployed: false,
        },
        approved: {
          experienceMonths: 0,
          latestEmploymentStart: null,
          targetNodeIds: targets.approved ?? [],
          currentlyEmployed: false,
        },
      },
    },
  } as Region;
}

describe("regionNamesByPlaceId", () => {
  it("names the region that owns a company", () => {
    const regions = {
      teryt1462: region("Płock", "1462", { approved: ["orlen"] }),
    };

    expect(regionNamesByPlaceId(regions, "approved")).toEqual({
      orlen: "Płock",
    });
  });

  it("reads the edge scope it is asked for", () => {
    const regions = {
      teryt1462: region("Płock", "1462", {
        all: ["orlen", "pending"],
        approved: ["orlen"],
      }),
    };

    expect(regionNamesByPlaceId(regions, "approved")).toEqual({
      orlen: "Płock",
    });
    expect(regionNamesByPlaceId(regions, "all")).toEqual({
      orlen: "Płock",
      pending: "Płock",
    });
  });

  it("prefers the most specific region claiming a company", () => {
    // The region hierarchy shares the owns edge, so a województwo can end up
    // listing a company its powiat owns.
    const regions = {
      teryt14: region("mazowieckie", "14", {
        approved: ["teryt1462", "orlen"],
      }),
      teryt1462: region("Płock", "1462", { approved: ["orlen"] }),
    };

    expect(regionNamesByPlaceId(regions, "approved").orlen).toBe("Płock");
  });

  it("survives regions the stats job has not reached", () => {
    const regions = {
      teryt14: { name: "mazowieckie", type: "region", teryt: "14" } as Region,
    };

    expect(regionNamesByPlaceId(regions, "approved")).toEqual({});
  });
});
