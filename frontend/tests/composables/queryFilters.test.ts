import { describe, it, expect, vi, beforeEach } from "vitest";
import { reactive } from "vue";
import type { LocationQuery } from "vue-router";
import { useQueryFilters } from "../../app/composables/queryFilters";

const route = reactive({
  name: "eksploruj-tabela",
  path: "/eksploruj/tabela",
}) as {
  name: string;
  path: string;
  query: LocationQuery;
};
const push = vi.fn();
const replace = vi.fn();

vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue-router")>();
  return {
    ...actual,
    useRoute: () => route,
    useRouter: () => ({ push, replace }),
  };
});

/** Applies what the last router call would have done to the url. */
function lastQuery(): LocationQuery | undefined {
  const call = push.mock.calls.at(-1) ?? replace.mock.calls.at(-1);
  return call?.[0]?.query;
}

beforeEach(() => {
  route.name = "eksploruj-tabela";
  route.path = "/eksploruj/tabela";
  route.query = {};
  push.mockClear();
  replace.mockClear();
});

describe("useQueryFilters", () => {
  it("keeps an unset filter out of the url", () => {
    const { stringFilter } = useQueryFilters();
    const teryt = stringFilter("teryt");

    expect(teryt.value).toBeNull();

    teryt.value = "1462";
    expect(lastQuery()).toEqual({ teryt: "1462" });

    route.query = { teryt: "1462" };
    teryt.value = null;
    expect(lastQuery()).toEqual({});
  });

  it("leaves a choice filter's default out of the url", () => {
    route.query = { visibility: "private" };
    const { choiceFilter } = useQueryFilters();
    const visibility = choiceFilter<"all" | "public" | "private">(
      "visibility",
      "all",
    );

    expect(visibility.value).toBe("private");

    visibility.value = "all";
    expect(lastQuery()).toEqual({});
  });

  it("reads a repeatable filter as a deduplicated list", () => {
    route.query = { krs: ["1", "2", "1"] };
    const { arrayFilter } = useQueryFilters();

    expect(arrayFilter("krs").value).toEqual(["1", "2"]);
  });

  it("drops the parameters a filter change invalidates", () => {
    route.query = { page: "4", teryt: "1462" };
    const { stringFilter } = useQueryFilters({ resetOnChange: ["page"] });

    stringFilter("teryt").value = "2261";
    expect(lastQuery()).toEqual({ teryt: "2261" });
  });

  it("does not touch the url when nothing would change", () => {
    route.query = { teryt: "1462" };
    const { setQuery, stringFilter } = useQueryFilters();

    stringFilter("teryt").value = "1462";
    setQuery({ page: undefined, itemsPerPage: undefined });

    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("refuses to write once the user has left the page", () => {
    const { stringFilter } = useQueryFilters();
    const teryt = stringFilter("teryt");

    // A late callback - a table reporting its options, a request resuming -
    // must not push this page's filters onto the one the user moved to.
    route.name = "index";
    route.path = "/";
    teryt.value = "1462";

    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("still recognises its page after a route parameter changes", () => {
    route.name = "eksploruj-autograf-type";
    route.path = "/eksploruj/autograf/spolki-partie";
    const { stringFilter } = useQueryFilters();

    route.path = "/eksploruj/autograf/mapa";
    stringFilter("teryt").value = "1462";

    expect(lastQuery()).toEqual({ teryt: "1462" });
  });
});
