/** A Firestore that keeps its documents in a map, for the routes whose
 * correctness is in what they leave behind and in what order: transactions,
 * batches, merges and field deletes behave as Firestore's do, closely enough to
 * replay a race between two requests by hand.
 *
 * Not a query engine. `where` takes equality on one field, which is all the
 * avatar and moderation routes ask of it, and anything else is refused loudly
 * rather than answered wrong. Shared by `users-avatar.test.ts` and
 * `admin-users-moderate.test.ts`; each mocks `firebase-admin/firestore` with
 * `module` from here, through a dynamic import, since `vi.mock` is hoisted
 * above the imports.
 */

type Data = Record<string, unknown>;

export const DELETE_FIELD = Object.freeze({ fieldValue: "delete" });

/** `set(..., {merge: true})` and `update` alike: top-level fields, with the
 * delete sentinel taking a field out. */
function merged(before: Data | undefined, patch: Data): Data {
  const kept = Object.entries(before ?? {}).filter(([key]) => !(key in patch));
  const given = Object.entries(patch).filter(
    ([, value]) => value !== DELETE_FIELD,
  );
  return Object.fromEntries([...kept, ...given]);
}

function written(patch: Data): Data {
  return merged(undefined, patch);
}

export function createMemoryFirestore() {
  const docs = new Map<string, Data>();
  /** Every write as it landed: `set images/img1`, `delete images/old1`. */
  const log: string[] = [];
  const counters = new Map<string, number>();
  /** Called once a query has read its documents, before it returns them - the
   * moment another request could slip a write in. Cleared after one use. */
  const hooks: { afterQuery: ((collection: string) => void) | null } = {
    afterQuery: null,
  };

  const nextId = (collection: string) => {
    const n = (counters.get(collection) ?? 0) + 1;
    counters.set(collection, n);
    // `images` → img1, `userActions` → act1: short enough to read in an
    // assertion, and matching IMAGE_ID_PATTERN.
    const prefix = collection === "images" ? "img" : collection.slice(0, 3);
    return `${prefix}${n}`;
  };

  const snapshot = (path: string, data: Data | undefined) => ({
    id: path.split("/").pop()!,
    ref: docRef(path),
    exists: data !== undefined,
    data: () => (data === undefined ? undefined : { ...data }),
    get: (field: string) => data?.[field],
  });

  const apply = {
    set(path: string, data: Data, options?: { merge?: boolean }) {
      docs.set(
        path,
        options?.merge ? merged(docs.get(path), data) : written(data),
      );
      log.push(`set ${path}`);
    },
    update(path: string, data: Data) {
      if (!docs.has(path)) {
        throw Object.assign(new Error(`No document to update: ${path}`), {
          code: 5,
        });
      }
      docs.set(path, merged(docs.get(path), data));
      log.push(`update ${path}`);
    },
    create(path: string, data: Data) {
      if (docs.has(path)) {
        throw Object.assign(new Error(`Document already exists: ${path}`), {
          code: 6,
        });
      }
      docs.set(path, written(data));
      log.push(`create ${path}`);
    },
    delete(path: string) {
      docs.delete(path);
      log.push(`delete ${path}`);
    },
  };

  function docRef(path: string) {
    return {
      id: path.split("/").pop()!,
      path,
      get: async () => snapshot(path, docs.get(path)),
      set: async (data: Data, options?: { merge?: boolean }) =>
        apply.set(path, data, options),
      update: async (data: Data) => apply.update(path, data),
      delete: async () => apply.delete(path),
    };
  }
  type DocRef = ReturnType<typeof docRef>;

  function query(collection: string, field: string, value: unknown) {
    const run = async () => {
      const found = [...docs.entries()]
        .filter(
          ([path, data]) =>
            path.startsWith(`${collection}/`) &&
            path.split("/").length === 2 &&
            data[field] === value,
        )
        .map(([path, data]) => snapshot(path, data));
      const hook = hooks.afterQuery;
      hooks.afterQuery = null;
      hook?.(collection);
      return { docs: found, empty: found.length === 0, size: found.length };
    };
    return { get: run, select: () => ({ get: run }) };
  }

  /** Writes queued by a batch or a transaction, applied on commit in order. */
  function writeQueue() {
    const queued: (() => void)[] = [];
    return {
      queued,
      set: (ref: DocRef, data: Data, options?: { merge?: boolean }) => {
        queued.push(() => apply.set(ref.path, data, options));
      },
      update: (ref: DocRef, data: Data) => {
        queued.push(() => apply.update(ref.path, data));
      },
      create: (ref: DocRef, data: Data) => {
        queued.push(() => apply.create(ref.path, data));
      },
      delete: (ref: DocRef) => {
        queued.push(() => apply.delete(ref.path));
      },
      flush: () => queued.splice(0).forEach((write) => write()),
    };
  }

  const db = {
    collection: (name: string) => ({
      doc: (id?: string) => docRef(`${name}/${id ?? nextId(name)}`),
      where: (field: string, op: string, value: unknown) => {
        if (op !== "==") throw new Error(`unsupported query op ${op}`);
        return query(name, field, value);
      },
    }),
    batch: () => {
      const queue = writeQueue();
      const batch = {
        set: (ref: DocRef, data: Data, options?: { merge?: boolean }) => {
          queue.set(ref, data, options);
          return batch;
        },
        update: (ref: DocRef, data: Data) => {
          queue.update(ref, data);
          return batch;
        },
        delete: (ref: DocRef) => {
          queue.delete(ref);
          return batch;
        },
        commit: async () => queue.flush(),
      };
      return batch;
    },
    /** Reads see the documents as they are; writes land together once the
     * callback resolves, and not at all if it throws. A read after a write is
     * refused, as Firestore refuses it. */
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const queue = writeQueue();
      const tx = {
        get: async (ref: DocRef) => {
          if (queue.queued.length > 0) {
            throw new Error("Firestore transactions require all reads first");
          }
          return snapshot(ref.path, docs.get(ref.path));
        },
        set: (ref: DocRef, data: Data, options?: { merge?: boolean }) => {
          queue.set(ref, data, options);
          return tx;
        },
        update: (ref: DocRef, data: Data) => {
          queue.update(ref, data);
          return tx;
        },
        create: (ref: DocRef, data: Data) => {
          queue.create(ref, data);
          return tx;
        },
        delete: (ref: DocRef) => {
          queue.delete(ref);
          return tx;
        },
      };
      const result = await fn(tx);
      queue.flush();
      return result;
    },
    getAll: async (...args: unknown[]) => {
      const last = args[args.length - 1] as { fieldMask?: string[] } | DocRef;
      const mask = "fieldMask" in last ? last.fieldMask : undefined;
      const refs = (mask ? args.slice(0, -1) : args) as DocRef[];
      return refs.map((ref) => {
        const data = docs.get(ref.path);
        const masked =
          data && mask
            ? Object.fromEntries(
                Object.entries(data).filter(([key]) => mask.includes(key)),
              )
            : data;
        return snapshot(ref.path, masked);
      });
    },
  };

  return {
    docs,
    log,
    hooks,
    /** What the route modules see as `firebase-admin/firestore`. */
    module: {
      getFirestore: () => db,
      FieldValue: { delete: () => DELETE_FIELD },
    },
    /** Puts a document in place without logging it as a write. */
    seed(path: string, data: Data) {
      docs.set(path, { ...data });
    },
    reset() {
      docs.clear();
      log.length = 0;
      counters.clear();
      hooks.afterQuery = null;
    },
  };
}

export type MemoryFirestore = ReturnType<typeof createMemoryFirestore>;
