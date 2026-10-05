/** Just enough of the admin SDK's Firestore, kept in a Map, for code that
 * reads and writes documents by id: `getAll` with a field mask, transactions
 * with create/set/update/delete, equality queries and `count()`.
 *
 * Written for the profile code, whose behaviour is mostly about which
 * documents end up existing - a handle claimed, the old one released, a
 * counter bumped - which a fake that remembers documents shows directly, and a
 * mock that remembers calls can only imply.
 *
 * Two of the real SDK's rules are enforced, because breaking either one is a
 * bug the emulator would catch and a looser fake would hide: a transaction
 * reads everything before it writes anything, and `create` fails on a document
 * that exists.
 */

type Data = Record<string, unknown>;

export type FakeSnapshot = {
  id: string;
  exists: boolean;
  ref: FakeRef;
  data: () => Data | undefined;
  get: (field: string) => unknown;
};

const clone = <T>(value: T): T => structuredClone(value);

/** A field mask applied to one document, as Firestore does: only the named
 * top-level fields come back. */
const mask = (data: Data | undefined, fields?: string[]) =>
  data && fields
    ? Object.fromEntries(
        Object.entries(data).filter(([key]) => fields.includes(key)),
      )
    : data;

export class FakeRef {
  constructor(
    readonly db: FakeFirestore,
    readonly collectionName: string,
    readonly id: string,
  ) {}

  get path() {
    return `${this.collectionName}/${this.id}`;
  }

  async get(): Promise<FakeSnapshot> {
    this.db.reads.push(this.path);
    return this.db.snapshot(this);
  }

  async set(data: Data, options?: { merge?: boolean }) {
    this.db.write("set", this, data, options?.merge);
  }

  async create(data: Data) {
    if (this.db.docs.has(this.path)) throw alreadyExists(this.path);
    this.db.write("create", this, data);
  }

  async update(data: Data) {
    if (!this.db.docs.has(this.path)) throw notFound(this.path);
    this.db.write("update", this, data, true);
  }

  async delete() {
    this.db.write("delete", this);
  }
}

class FakeQuery {
  constructor(
    readonly db: FakeFirestore,
    readonly collectionName: string,
    readonly filters: [string, unknown][] = [],
  ) {}

  where(field: string, op: string, value: unknown) {
    if (op !== "==") throw new Error(`the fake only knows ==, not ${op}`);
    return new FakeQuery(this.db, this.collectionName, [
      ...this.filters,
      [field, value],
    ]);
  }

  private matching() {
    const prefix = `${this.collectionName}/`;
    return [...this.db.docs.entries()].filter(
      ([path, data]) =>
        path.startsWith(prefix) &&
        !path.slice(prefix.length).includes("/") &&
        this.filters.every(([field, value]) => data[field] === value),
    );
  }

  count() {
    return {
      get: async () => {
        this.db.counts.push({
          collection: this.collectionName,
          filters: this.filters,
        });
        const count = this.matching().length;
        return { data: () => ({ count }) };
      },
    };
  }
}

class FakeCollection extends FakeQuery {
  private autoId = 0;

  doc(id?: string) {
    return new FakeRef(
      this.db,
      this.collectionName,
      id ?? `auto${++this.autoId}`,
    );
  }
}

const alreadyExists = (path: string) =>
  Object.assign(new Error(`ALREADY_EXISTS: ${path}`), { code: 6 });
const notFound = (path: string) =>
  Object.assign(new Error(`NOT_FOUND: ${path}`), { code: 5 });

type PendingWrite = {
  op: "set" | "create" | "update" | "delete";
  ref: FakeRef;
  data?: Data;
  merge?: boolean;
};

class FakeTransaction {
  private pending: PendingWrite[] = [];

  constructor(private readonly db: FakeFirestore) {}

  private noWritesYet() {
    if (this.pending.length > 0) {
      throw new Error(
        "Firestore transactions require all reads to be executed before all writes.",
      );
    }
  }

  async get(ref: FakeRef) {
    this.noWritesYet();
    return ref.get();
  }

  async getAll(...refs: FakeRef[]) {
    this.noWritesYet();
    return this.db.getAll(...refs);
  }

  create(ref: FakeRef, data: Data) {
    this.pending.push({ op: "create", ref, data });
    return this;
  }

  set(ref: FakeRef, data: Data, options?: { merge?: boolean }) {
    this.pending.push({ op: "set", ref, data, merge: options?.merge });
    return this;
  }

  update(ref: FakeRef, data: Data) {
    this.pending.push({ op: "update", ref, data, merge: true });
    return this;
  }

  delete(ref: FakeRef) {
    this.pending.push({ op: "delete", ref });
    return this;
  }

  /** All or nothing, like the real commit. */
  commit() {
    for (const { op, ref } of this.pending) {
      if (op === "create" && this.db.docs.has(ref.path)) {
        throw alreadyExists(ref.path);
      }
      if (op === "update" && !this.db.docs.has(ref.path)) {
        throw notFound(ref.path);
      }
    }
    for (const { op, ref, data, merge } of this.pending) {
      this.db.write(op, ref, data, merge);
    }
  }
}

export class FakeFirestore {
  docs = new Map<string, Data>();
  /** Paths read one at a time. */
  reads: string[] = [];
  /** Every `getAll`, with the paths it named and its field mask. */
  getAllCalls: { paths: string[]; fieldMask?: string[] }[] = [];
  /** Every `count()` run. */
  counts: { collection: string; filters: [string, unknown][] }[] = [];
  /** Every write that landed, in order. */
  writes: { op: string; path: string; data?: Data }[] = [];

  reset() {
    this.docs.clear();
    this.reads = [];
    this.getAllCalls = [];
    this.counts = [];
    this.writes = [];
  }

  /** Puts a document in place without counting it as a write. */
  seed(path: string, data: Data) {
    this.docs.set(path, clone(data));
  }

  /** A document as it is now, or undefined. */
  read(path: string) {
    return this.docs.get(path);
  }

  collection(name: string) {
    return new FakeCollection(this, name);
  }

  snapshot(ref: FakeRef, fieldMask?: string[]): FakeSnapshot {
    const stored = this.docs.get(ref.path);
    const data = mask(stored ? clone(stored) : undefined, fieldMask);
    return {
      id: ref.id,
      exists: !!stored,
      ref,
      data: () => data,
      get: (field: string) => data?.[field],
    };
  }

  async getAll(...args: (FakeRef | { fieldMask?: string[] })[]) {
    const last = args.at(-1);
    const options =
      last && !(last instanceof FakeRef)
        ? (args.pop() as { fieldMask?: string[] })
        : undefined;
    const refs = args as FakeRef[];
    this.getAllCalls.push({
      paths: refs.map((ref) => ref.path),
      fieldMask: options?.fieldMask,
    });
    return refs.map((ref) => this.snapshot(ref, options?.fieldMask));
  }

  async runTransaction<T>(fn: (tx: FakeTransaction) => Promise<T>) {
    const tx = new FakeTransaction(this);
    const result = await fn(tx);
    tx.commit();
    return result;
  }

  write(op: string, ref: FakeRef, data?: Data, merge?: boolean) {
    this.writes.push({ op, path: ref.path, data: data && clone(data) });
    if (op === "delete") {
      this.docs.delete(ref.path);
      return;
    }
    const base = merge ? (this.docs.get(ref.path) ?? {}) : {};
    this.docs.set(ref.path, { ...base, ...clone(data ?? {}) });
  }
}
