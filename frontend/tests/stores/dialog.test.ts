import { setActivePinia, createPinia } from "pinia";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useDialogStore } from "../../app/stores/dialog";
import * as entityModule from "../../app/composables/entity";

// Mock useEntity module
vi.mock("../../app/composables/entity", async () => {
  const { ref } = await import("vue");
  const mockEntities = ref({});
  const mockSubmit = vi
    .fn()
    .mockImplementation((_val) => ({ key: "mockedKey" }));

  return {
    useEntity: (_type: string) => {
      return {
        entities: mockEntities,
        submit: mockSubmit,
      };
    },
    _mockEntities: mockEntities,
    _mockSubmit: mockSubmit,
  };
});

const mockEntities = (entityModule as any)._mockEntities;
const mockSubmit = (entityModule as any)._mockSubmit;

describe("Dialog Store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockEntities.value = {};
    mockSubmit.mockClear();
  });

  it("opens a dialog", () => {
    const store = useDialogStore();
    store.open({ type: "person", name: "Test Person" });

    expect(store.shown).toBe(true);
    expect(store.dialogs).toHaveLength(1);
    expect(store.dialogs[0].type).toBe("person");
    expect(store.dialogs[0].value.name).toBe("Test Person");
  });

  it("closes a dialog", async () => {
    const store = useDialogStore();
    store.open({ type: "person" });
    expect(store.dialogs).toHaveLength(1);

    await store.close(0, false);

    expect(store.dialogs).toHaveLength(0);
    expect(store.shown).toBe(false);
  });

  it("submits data on close if shouldSubmit is true", async () => {
    const store = useDialogStore();
    store.open({ type: "person" });

    await store.close(0, true);

    expect(mockSubmit).toHaveBeenCalled();
  });

  it("opens existing entity dialog", () => {
    mockEntities.value = {
      "existing-id": { name: "Existing Person" },
    };
    const store = useDialogStore();

    store.openExisting("existing-id");

    expect(store.shown).toBe(true);
    expect(store.dialogs[0].value).toEqual({ name: "Existing Person" });
    expect(store.dialogs[0].editKey).toBe("existing-id");
  });
});
