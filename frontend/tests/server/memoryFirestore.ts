/**
 * Firestore in memory, for a test that drives real route handlers end to end:
 * documents, queries (filters, ordering, cursors, field masks, counts), batches
 * and transactions, with the value types and field transforms the server code
 * writes. Stand it in for the module with
 *
 *   vi.mock("firebase-admin/firestore", () =>
 *     memoryFirestoreModule(sharedMemoryFirestore()),
 *   );
 *
 * imported before the code under test, which then shares the one database
 * with the test.
 *
 * It follows the real service where the routes depend on it: a query leaves
 * out a document that lacks a field it filters or orders on, `data()` hands
 * out a copy, an update of a missing document fails, and a batch lands whole
 * at its commit.
 */

type Data = Record<string, unknown>;

/** A field transform, as `FieldValue` makes them. */
export class MemoryTransform {
  constructor(
    readonly op:
      "delete" | "arrayUnion" | "arrayRemove" | "increment" | "serverTimestamp",
    readonly values: unknown[] = [],
  ) {}
}

/** Strictly increasing, so ordering by write time is deterministic. */
let clock = Date.parse("2026-11-20T10:00:00.000Z");

export class MemoryTimestamp {
  constructor(readonly millis: number) {}
  static now() {
    clock += 1000;
    return new MemoryTimestamp(clock);
  }
  static fromDate(date: Date) {
    return new MemoryTimestamp(date.getTime());
  }
  static fromMillis(millis: number) {
    return new MemoryTimestamp(millis);
  }
  get seconds() {
    return Math.floor(this.millis / 1000);
  }
  get nanoseconds() {
    return (this.millis % 1000) * 1_000_000;
  }
  toMillis() {
    return this.millis;
  }
  toDate() {
    return new Date(this.millis);
  }
  isEqual(other: unknown) {
    return other instanceof MemoryTimestamp && other.millis === this.millis;
  }
  toJSON() {
    return this.toDate().toISOString();
  }
}

export class MemoryFieldPath {
  readonly segments: string[];
  constructor(...segments: string[]) {
    this.segments = segments;
  }
  static documentId() {
    return new MemoryFieldPath("__name__");
  }
}

type Operator =
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "in"
  | "not-in"
  | "array-contains"
  | "array-contains-any";

type FieldFilter = {
  field: string | MemoryFieldPath;
  op: Operator;
  value: unknown;
};
type CompositeFilter = { kind: "or" | "and"; filters: MemoryFilter[] };
type MemoryFilter = FieldFilter | CompositeFilter;

/** `Filter.where`, `Filter.or` and `Filter.and`. */
export const MemoryFilters = {
  where: (field: string | MemoryFieldPath, op: Operator, value: unknown) =>
    ({ field, op, value }) as FieldFilter,
  or: (...filters: MemoryFilter[]) =>
    ({ kind: "or", filters }) as CompositeFilter,
  and: (...filters: MemoryFilter[]) =>
    ({ kind: "and", filters }) as CompositeFilter,
};

function isPlain(value: unknown): value is Data {
  if (!value || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** A copy of what is stored: maps and arrays anew, value types as they are. */
function copy<T>(value: T): T {
  if (Array.isArray(value)) return value.map(copy) as T;
  if (isPlain(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, copy(item)]),
    ) as T;
  }
  return value;
}

function pathOf(field: string | MemoryFieldPath): string[] {
  return typeof field === "string" ? field.split(".") : field.segments;
}

function isDocumentId(field: string | MemoryFieldPath): boolean {
  const path = pathOf(field);
  return path.length === 1 && path[0] === "__name__";
}

/** The value at a field path, and whether the document has it at all. */
function lookup(
  data: Data,
  path: string[],
): { found: boolean; value: unknown } {
  let current: unknown = data;
  for (const segment of path) {
    if (!isPlain(current) || !Object.hasOwn(current, segment)) {
      return { found: false, value: undefined };
    }
    current = current[segment];
  }
  return { found: true, value: current };
}

/** Firestore's order of value types, then of values within one. */
function typeRank(value: unknown): number {
  if (value === null) return 0;
  if (typeof value === "boolean") return 1;
  if (typeof value === "number") return 2;
  if (value instanceof MemoryTimestamp) return 3;
  if (typeof value === "string") return 4;
  if (value instanceof MemoryDocumentReference) return 6;
  if (Array.isArray(value)) return 8;
  return 9;
}

function compare(a: unknown, b: unknown): number {
  const rank = typeRank(a) - typeRank(b);
  if (rank !== 0) return rank;
  if (a instanceof MemoryTimestamp && b instanceof MemoryTimestamp) {
    return a.millis - b.millis;
  }
  if (
    a instanceof MemoryDocumentReference &&
    b instanceof MemoryDocumentReference
  ) {
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  }
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") {
    return Number(a) - Number(b);
  }
  if (typeof a === "string" && typeof b === "string") {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const order = compare(a[i], b[i]);
      if (order !== 0) return order;
    }
    return a.length - b.length;
  }
  return 0;
}

function same(a: unknown, b: unknown): boolean {
  if (
    a instanceof MemoryDocumentReference ||
    b instanceof MemoryDocumentReference
  ) {
    return (
      a instanceof MemoryDocumentReference &&
      b instanceof MemoryDocumentReference &&
      a.path === b.path
    );
  }
  if (a instanceof MemoryTimestamp || b instanceof MemoryTimestamp) {
    return (
      a instanceof MemoryTimestamp &&
      b instanceof MemoryTimestamp &&
      a.isEqual(b)
    );
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => same(item, b[i]))
    );
  }
  if (isPlain(a) || isPlain(b)) {
    if (!isPlain(a) || !isPlain(b)) return false;
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && same(a[key], b[key]))
    );
  }
  return a === b;
}

function matches(id: string, data: Data, filter: MemoryFilter): boolean {
  if ("kind" in filter) {
    return filter.kind === "or"
      ? filter.filters.some((inner) => matches(id, data, inner))
      : filter.filters.every((inner) => matches(id, data, inner));
  }
  const { found, value } = isDocumentId(filter.field)
    ? { found: true, value: id }
    : lookup(data, pathOf(filter.field));
  if (!found) return false;
  const wanted = (raw: unknown) =>
    raw instanceof MemoryDocumentReference && isDocumentId(filter.field)
      ? raw.id
      : raw;
  switch (filter.op) {
    case "==":
      return same(value, wanted(filter.value));
    case "!=":
      return value !== null && !same(value, wanted(filter.value));
    case "<":
    case "<=":
    case ">":
    case ">=": {
      const target = wanted(filter.value);
      if (typeRank(value) !== typeRank(target)) return false;
      const order = compare(value, target);
      return filter.op === "<"
        ? order < 0
        : filter.op === "<="
          ? order <= 0
          : filter.op === ">"
            ? order > 0
            : order >= 0;
    }
    case "in":
      return (filter.value as unknown[]).some((item) =>
        same(value, wanted(item)),
      );
    case "not-in":
      return (
        value !== null &&
        !(filter.value as unknown[]).some((item) => same(value, wanted(item)))
      );
    case "array-contains":
      return (
        Array.isArray(value) && value.some((item) => same(item, filter.value))
      );
    case "array-contains-any":
      return (
        Array.isArray(value) &&
        value.some((item) =>
          (filter.value as unknown[]).some((other) => same(item, other)),
        )
      );
  }
}

/** Writes `value` at a field path, making the maps on the way. */
function place(data: Data, path: string[], value: unknown) {
  let current = data;
  for (const segment of path.slice(0, -1)) {
    if (!isPlain(current[segment])) current[segment] = {};
    current = current[segment] as Data;
  }
  const last = path[path.length - 1]!;
  if (value instanceof MemoryTransform) {
    applyTransform(current, last, value);
  } else {
    current[last] = resolved(value);
  }
}

/** A value with every transform nested in it carried out. */
function resolved(value: unknown): unknown {
  if (value instanceof MemoryTransform) {
    if (value.op === "serverTimestamp") return MemoryTimestamp.now();
    if (value.op === "arrayUnion") return copy(value.values);
    if (value.op === "increment") return value.values[0];
    if (value.op === "arrayRemove") return [];
    return undefined;
  }
  if (Array.isArray(value)) return value.map(resolved);
  if (isPlain(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([, item]) =>
            !(item instanceof MemoryTransform && item.op === "delete"),
        )
        .map(([key, item]) => [key, resolved(item)]),
    );
  }
  return value;
}

function applyTransform(data: Data, key: string, transform: MemoryTransform) {
  const held = data[key];
  switch (transform.op) {
    case "delete":
      Reflect.deleteProperty(data, key);
      return;
    case "serverTimestamp":
      data[key] = MemoryTimestamp.now();
      return;
    case "increment":
      data[key] =
        (typeof held === "number" ? held : 0) + Number(transform.values[0]);
      return;
    case "arrayUnion": {
      const list = Array.isArray(held) ? [...held] : [];
      for (const item of transform.values) {
        if (!list.some((other) => same(other, item))) list.push(copy(item));
      }
      data[key] = list;
      return;
    }
    case "arrayRemove":
      data[key] = (Array.isArray(held) ? held : []).filter(
        (item) => !transform.values.some((other) => same(item, other)),
      );
      return;
  }
}

/** `merge: true`: maps merge key by key, everything else is replaced. */
function mergeInto(target: Data, source: Data) {
  for (const [key, value] of Object.entries(source)) {
    if (value instanceof MemoryTransform) applyTransform(target, key, value);
    else if (isPlain(value) && isPlain(target[key])) {
      mergeInto(target[key] as Data, value);
    } else target[key] = resolved(value);
  }
}

export class MemoryDocumentSnapshot {
  constructor(
    readonly ref: MemoryDocumentReference,
    private readonly stored: Data | undefined,
    private readonly mask?: string[],
  ) {}
  get id() {
    return this.ref.id;
  }
  get exists() {
    return this.stored !== undefined;
  }
  data(): Data | undefined {
    if (!this.stored) return undefined;
    if (!this.mask) return copy(this.stored);
    const masked: Data = {};
    for (const field of this.mask) {
      const { found, value } = lookup(this.stored, field.split("."));
      if (found) place(masked, field.split("."), copy(value));
    }
    return masked;
  }
  get(field: string | MemoryFieldPath): unknown {
    const data = this.data();
    return data ? lookup(data, pathOf(field)).value : undefined;
  }
}

export class MemoryDocumentReference {
  constructor(
    readonly firestore: MemoryFirestore,
    readonly collectionId: string,
    readonly id: string,
  ) {}
  get path() {
    return `${this.collectionId}/${this.id}`;
  }
  get parent() {
    return this.firestore.collection(this.collectionId);
  }
  async get() {
    return this.firestore.snapshot(this);
  }
  async set(data: Data, options?: { merge?: boolean }) {
    this.firestore.write({
      kind: "set",
      ref: this,
      data,
      merge: options?.merge,
    });
  }
  async update(...args: unknown[]) {
    this.firestore.write({ kind: "update", ref: this, data: updateData(args) });
  }
  async create(data: Data) {
    this.firestore.write({ kind: "create", ref: this, data });
  }
  async delete() {
    this.firestore.write({ kind: "delete", ref: this });
  }
  isEqual(other: unknown) {
    return other instanceof MemoryDocumentReference && other.path === this.path;
  }
  toJSON() {
    return this.path;
  }
}

/** `update`'s two shapes: a map of paths (and maybe a precondition, which is
 * not checked), or path and value pairs. */
function updateData(args: unknown[]): Data {
  const [first] = args;
  if (typeof first !== "string" && !(first instanceof MemoryFieldPath)) {
    return first as Data;
  }
  const data: Data = {};
  for (let i = 0; i < args.length; i += 2) {
    const field = args[i] as string | MemoryFieldPath;
    data[pathOf(field).join("\u0000")] = args[i + 1];
  }
  return data;
}

type Write =
  | { kind: "set"; ref: MemoryDocumentReference; data: Data; merge?: boolean }
  | { kind: "update"; ref: MemoryDocumentReference; data: Data }
  | { kind: "create"; ref: MemoryDocumentReference; data: Data }
  | { kind: "delete"; ref: MemoryDocumentReference };

type Order = { field: string | MemoryFieldPath; direction: "asc" | "desc" };

export class MemoryQuery {
  constructor(
    readonly firestore: MemoryFirestore,
    readonly collectionId: string,
    private readonly filters: MemoryFilter[] = [],
    private readonly orders: Order[] = [],
    private readonly max?: number,
    private readonly skip = 0,
    private readonly cursor?: unknown[],
    private readonly mask?: string[],
  ) {}

  private with(changes: {
    filters?: MemoryFilter[];
    orders?: Order[];
    max?: number;
    skip?: number;
    cursor?: unknown[];
    mask?: string[];
  }) {
    return new MemoryQuery(
      this.firestore,
      this.collectionId,
      changes.filters ?? this.filters,
      changes.orders ?? this.orders,
      changes.max ?? this.max,
      changes.skip ?? this.skip,
      changes.cursor ?? this.cursor,
      changes.mask ?? this.mask,
    );
  }

  where(
    field: string | MemoryFieldPath | MemoryFilter,
    op?: Operator,
    value?: unknown,
  ) {
    const filter =
      typeof field === "string" || field instanceof MemoryFieldPath
        ? { field, op: op!, value }
        : field;
    return this.with({ filters: [...this.filters, filter] });
  }
  orderBy(field: string | MemoryFieldPath, direction: "asc" | "desc" = "asc") {
    return this.with({ orders: [...this.orders, { field, direction }] });
  }
  limit(max: number) {
    return this.with({ max });
  }
  offset(skip: number) {
    return this.with({ skip });
  }
  select(...mask: string[]) {
    return this.with({ mask });
  }
  startAfter(...values: unknown[]) {
    const [first] = values;
    if (first instanceof MemoryDocumentSnapshot) {
      const data = first.data() ?? {};
      return this.with({
        cursor: [
          ...this.orders.map((order) =>
            isDocumentId(order.field)
              ? first.id
              : lookup(data, pathOf(order.field)).value,
          ),
          first.id,
        ],
      });
    }
    return this.with({ cursor: values });
  }

  private matching(): [string, Data][] {
    const orderBy = (id: string, data: Data, order: Order) =>
      isDocumentId(order.field) ? id : lookup(data, pathOf(order.field)).value;
    let rows = [...this.firestore.documents(this.collectionId)]
      .filter(([id, data]) =>
        this.filters.every((filter) => matches(id, data, filter)),
      )
      // A document without a field the query orders on is not in its index.
      .filter(([, data]) =>
        this.orders.every(
          (order) =>
            isDocumentId(order.field) ||
            lookup(data, pathOf(order.field)).found,
        ),
      );
    const orders: Order[] = [
      ...this.orders,
      ...(this.orders.some((order) => isDocumentId(order.field))
        ? []
        : [
            {
              field: MemoryFieldPath.documentId(),
              direction: this.orders.at(-1)?.direction ?? "asc",
            } as Order,
          ]),
    ];
    const ordered = (a: [string, Data], b: [string, Data]) => {
      for (const order of orders) {
        const sign = order.direction === "desc" ? -1 : 1;
        const result = compare(
          orderBy(a[0], a[1], order),
          orderBy(b[0], b[1], order),
        );
        if (result !== 0) return sign * result;
      }
      return 0;
    };
    rows.sort(ordered);
    if (this.cursor) {
      const cursor = this.cursor;
      rows = rows.filter(([id, data]) => {
        for (let i = 0; i < Math.min(cursor.length, orders.length); i++) {
          const order = orders[i]!;
          const sign = order.direction === "desc" ? -1 : 1;
          const result = sign * compare(orderBy(id, data, order), cursor[i]);
          if (result !== 0) return result > 0;
        }
        return false;
      });
    }
    rows = rows.slice(this.skip);
    return this.max === undefined ? rows : rows.slice(0, this.max);
  }

  async get() {
    const docs = this.matching().map(
      ([id, data]) =>
        new MemoryDocumentSnapshot(
          new MemoryDocumentReference(this.firestore, this.collectionId, id),
          data,
          this.mask,
        ),
    );
    this.firestore.reads += Math.max(docs.length, 1);
    return {
      docs,
      size: docs.length,
      empty: docs.length === 0,
      forEach: (fn: (doc: MemoryDocumentSnapshot) => void) => docs.forEach(fn),
    };
  }

  count() {
    return {
      get: async () => {
        const count = this.matching().length;
        return { data: () => ({ count }) };
      },
    };
  }

  stream() {
    const read = this.get();
    return (async function* () {
      yield* (await read).docs;
    })();
  }
}

export class MemoryCollection extends MemoryQuery {
  get id() {
    return this.collectionId;
  }
  doc(id?: string) {
    if (id !== undefined && id.includes("/")) {
      const [collection, ...rest] = id.split("/");
      return new MemoryDocumentReference(
        this.firestore,
        collection!,
        rest.join("/"),
      );
    }
    return new MemoryDocumentReference(
      this.firestore,
      this.collectionId,
      id ?? this.firestore.newId(),
    );
  }
  async add(data: Data) {
    const ref = this.doc();
    await ref.set(data);
    return ref;
  }
}

export class MemoryWriteBatch {
  private readonly writes: Write[] = [];
  constructor(private readonly firestore: MemoryFirestore) {}
  set(ref: MemoryDocumentReference, data: Data, options?: { merge?: boolean }) {
    this.writes.push({
      kind: "set",
      ref,
      data: copy(data),
      merge: options?.merge,
    });
    return this;
  }
  update(ref: MemoryDocumentReference, ...args: unknown[]) {
    this.writes.push({ kind: "update", ref, data: copy(updateData(args)) });
    return this;
  }
  create(ref: MemoryDocumentReference, data: Data) {
    this.writes.push({ kind: "create", ref, data: copy(data) });
    return this;
  }
  delete(ref: MemoryDocumentReference) {
    this.writes.push({ kind: "delete", ref });
    return this;
  }
  async commit() {
    // Whole or not at all: every write is checked before any lands.
    const staged = this.firestore.clone();
    for (const write of this.writes) staged.write(write);
    this.firestore.adopt(staged);
    return [];
  }
}

export class MemoryFirestore {
  private store = new Map<string, Map<string, Data>>();
  private generated = 0;
  /** Documents read, a query that finds nothing counting as one. */
  reads = 0;

  collection(name: string) {
    return new MemoryCollection(this, name);
  }
  doc(path: string) {
    const [collection, ...rest] = path.split("/");
    return new MemoryDocumentReference(this, collection!, rest.join("/"));
  }
  batch() {
    return new MemoryWriteBatch(this);
  }
  /** Each write lands as it is handed over. */
  bulkWriter() {
    const land = async (write: Write) => {
      this.write(write);
      return {};
    };
    return {
      set: (ref: MemoryDocumentReference, data: Data) =>
        land({ kind: "set", ref, data: copy(data) }),
      update: (ref: MemoryDocumentReference, data: Data) =>
        land({ kind: "update", ref, data: copy(data) }),
      delete: (ref: MemoryDocumentReference) => land({ kind: "delete", ref }),
      flush: async () => {},
      close: async () => {},
    };
  }
  async getAll(...args: unknown[]) {
    const last = args.at(-1);
    const options =
      last && !(last instanceof MemoryDocumentReference)
        ? (args.pop() as { fieldMask?: (string | MemoryFieldPath)[] })
        : undefined;
    const mask = options?.fieldMask?.map((field) => pathOf(field).join("."));
    return (args as MemoryDocumentReference[]).map((ref) => {
      this.reads += 1;
      return new MemoryDocumentSnapshot(ref, this.stored(ref), mask);
    });
  }
  async runTransaction<T>(
    update: (transaction: {
      get: (target: MemoryDocumentReference | MemoryQuery) => Promise<unknown>;
      getAll: (...refs: MemoryDocumentReference[]) => Promise<unknown>;
      set: MemoryWriteBatch["set"];
      update: MemoryWriteBatch["update"];
      create: MemoryWriteBatch["create"];
      delete: MemoryWriteBatch["delete"];
    }) => Promise<T>,
  ): Promise<T> {
    const batch = this.batch();
    const result = await update({
      get: (target) =>
        target instanceof MemoryDocumentReference ? target.get() : target.get(),
      getAll: (...refs) => this.getAll(...refs),
      set: (...args) => batch.set(...args),
      update: (...args) => batch.update(...args),
      create: (...args) => batch.create(...args),
      delete: (...args) => batch.delete(...args),
    });
    await batch.commit();
    return result;
  }

  newId() {
    this.generated += 1;
    return `generated-${String(this.generated).padStart(4, "0")}`;
  }

  /** Every document of a collection, as stored. */
  documents(collection: string): Map<string, Data> {
    return this.store.get(collection) ?? new Map();
  }
  /** One document as stored, for a test to read back. */
  stored(ref: MemoryDocumentReference): Data | undefined {
    return this.store.get(ref.collectionId)?.get(ref.id);
  }
  snapshot(ref: MemoryDocumentReference) {
    this.reads += 1;
    return new MemoryDocumentSnapshot(ref, this.stored(ref));
  }
  /** Puts documents in place for a test, without a write. */
  seed(documents: Record<string, Data>) {
    for (const [path, data] of Object.entries(documents)) {
      const [collection, ...rest] = path.split("/");
      this.put(collection!, rest.join("/"), copy(data));
    }
  }
  clear() {
    this.store = new Map();
    this.generated = 0;
    this.reads = 0;
  }

  write(write: Write) {
    const held = this.stored(write.ref);
    const { collectionId, id } = write.ref;
    switch (write.kind) {
      case "delete":
        this.store.get(collectionId)?.delete(id);
        return;
      case "create":
        if (held) throw new Error(`ALREADY_EXISTS: ${write.ref.path}`);
        this.put(collectionId, id, resolved(write.data) as Data);
        return;
      case "set": {
        if (write.merge && held) {
          const next = copy(held);
          mergeInto(next, write.data);
          this.put(collectionId, id, next);
        } else {
          this.put(collectionId, id, resolved(write.data) as Data);
        }
        return;
      }
      case "update": {
        if (!held)
          throw new Error(
            `NOT_FOUND: no document to update: ${write.ref.path}`,
          );
        const next = copy(held);
        for (const [key, value] of Object.entries(write.data)) {
          place(
            next,
            key.includes("\u0000") ? key.split("\u0000") : key.split("."),
            value,
          );
        }
        this.put(collectionId, id, next);
        return;
      }
    }
  }

  private put(collection: string, id: string, data: Data) {
    let documents = this.store.get(collection);
    if (!documents) this.store.set(collection, (documents = new Map()));
    documents.set(id, data);
  }

  clone() {
    const twin = new MemoryFirestore();
    for (const [collection, documents] of this.store) {
      twin.store.set(
        collection,
        new Map([...documents].map(([id, data]) => [id, copy(data)])),
      );
    }
    return twin;
  }
  adopt(other: MemoryFirestore) {
    this.store = other.store;
  }
}

let shared: MemoryFirestore | undefined;

/** The one database of a test file: the mock factory and the test both ask
 * for it, and each file loads this module anew. */
export function sharedMemoryFirestore() {
  return (shared ??= new MemoryFirestore());
}

/** What `vi.mock("firebase-admin/firestore", ...)` hands the code under test. */
export function memoryFirestoreModule(db: MemoryFirestore) {
  return {
    getFirestore: () => db,
    Timestamp: MemoryTimestamp,
    FieldValue: {
      delete: () => new MemoryTransform("delete"),
      serverTimestamp: () => new MemoryTransform("serverTimestamp"),
      arrayUnion: (...values: unknown[]) =>
        new MemoryTransform("arrayUnion", values),
      arrayRemove: (...values: unknown[]) =>
        new MemoryTransform("arrayRemove", values),
      increment: (by: number) => new MemoryTransform("increment", [by]),
    },
    FieldPath: MemoryFieldPath,
    Filter: MemoryFilters,
  };
}
