/* eslint-disable @typescript-eslint/no-explicit-any */
// TODO remove this and fix the typing

import { z } from "zod";
import { getFirestore } from "firebase-admin/firestore";
import {
  fetchNodes,
  fetchOptionsValidator,
  paginate,
} from "~~/server/utils/fetch";
import {
  buildStructuralFilterOps,
  type NodeFilterOp,
} from "~~/server/utils/nodeFilters";
import { authCachedEventHandler } from "~~/server/utils/handlers";
import { getUser } from "~~/server/utils/auth";
import { pageIsPublic } from "~~/shared/model";
import { defineEventHandler } from "h3";

const queryValidator = z.object({
  // We use generic fetch options for pagination
  ...fetchOptionsValidator.shape,

  type: z.enum(["person", "place", "article", "region"]).optional(),
  // TODO: remove party in the future
  party: z.string().optional(),
  parties: z.union([z.string(), z.array(z.string())]).optional(),
  teryt: z.string().optional(),
  krs: z.union([z.string(), z.array(z.string())]).optional(),
  category: z.string().optional(),
  visibility: z.enum(["public", "private"]).optional(),
  hideVoted: z.enum(["all", "no_votes", "has_votes"]).optional(),
  currentlyEmployed: z.enum(["all", "any", "selected"]).optional(),
  minEmploymentDate: z.string().optional(),
  minVotes: z.coerce.number().optional(),

  // Sorting parameters
  sortBy: z.string().optional(),
  sortDesc: z.enum(["true", "false"]).optional(),
});

export type Query = z.infer<typeof queryValidator>;

// We wrap the original logic in a cached handler to preserve the caching
// for endpoints that rely on the old behavior (e.g. useEntities).
const cachedHandler = authCachedEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (query) =>
    queryValidator.parse(query),
  );

  const opts = { personParties: query.parties || query.party };

  if (query.type) {
    return { nodes: await fetchNodes(query.type, opts) };
  }

  const [people, places, articles, regions] = await Promise.all([
    fetchNodes("person"),
    fetchNodes("place"),
    fetchNodes("article"),
    fetchNodes("region"),
  ]);

  const nodes = { ...people, ...places, ...articles, ...regions };
  return { nodes };
});

export default defineEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));

  // If pagination/sorting is requested, query Firestore directly for uncached results
  if (query.limit || query.sortBy) {
    const user = await getUser(event).catch(() => null);
    const db = getFirestore("koryta-pl");

    type Op = NodeFilterOp;
    const { ops, empty } = await buildStructuralFilterOps(
      db,
      query,
      user ? "all" : "approved",
    );
    if (empty) {
      return { nodes: {}, total: 0 };
    }

    if (!user) {
      if (query.visibility === "private") {
        return { nodes: {}, total: 0 };
      }
      ops.push({
        applyFs: (q) => q.where("stats.isApproved", "==", true),
        applyMem: (nodes) => nodes.filter((n) => n.stats?.isApproved === true),
      });
    } else {
      if (query.visibility === "public") {
        ops.push({
          applyFs: (q) => q.where("stats.isApproved", "==", true),
          applyMem: (nodes) =>
            nodes.filter((n) => n.stats?.isApproved === true),
        });
      } else if (query.visibility === "private") {
        ops.push({
          applyFs: (q) => q.where("stats.isApproved", "==", false),
          applyMem: (nodes) =>
            nodes.filter((n) => n.stats?.isApproved === false),
        });
      }
    }

    if (query.hideVoted === "no_votes") {
      ops.push({
        applyFs: (q) => q.where("stats.votes.humanVoted", "==", false),
        applyMem: (nodes) =>
          nodes.filter((n) => n.stats?.votes?.humanVoted === false),
      });
    } else if (query.hideVoted === "has_votes") {
      ops.push({
        applyFs: (q) => q.where("stats.votes.humanVoted", "==", true),
        applyMem: (nodes) =>
          nodes.filter((n) => n.stats?.votes?.humanVoted === true),
      });
    }

    if (query.sortBy) {
      let sortField = query.sortBy;
      if (sortField === "experience") {
        sortField = user
          ? "stats.edges.all.experienceMonths"
          : "stats.edges.approved.experienceMonths";
      } else if (sortField === "latestEmploymentStart") {
        sortField = user
          ? "stats.edges.all.latestEmploymentStart"
          : "stats.edges.approved.latestEmploymentStart";
      } else if (sortField === "notesCount") {
        sortField = "stats.notesCount";
      } else if (sortField === "visibility") {
        sortField = "stats.isApproved";
      } else if (sortField.startsWith("votes.")) {
        sortField = `stats.votes.${sortField.split(".")[1]}`;
      }

      const direction = query.sortDesc === "true" ? "desc" : "asc";
      ops.push({
        applyFs: (q) => q.orderBy(sortField, direction),
        applyMem: (nodes) => {
          return [...nodes].sort((a, b) => {
            const getVal = (obj: any, path: string) =>
              path.split(".").reduce((o, i) => o?.[i], obj);
            const valA = getVal(a, sortField);
            const valB = getVal(b, sortField);

            if (valA === valB) return 0;
            if (valA === undefined || valA === null)
              return direction === "desc" ? 1 : -1;
            if (valB === undefined || valB === null)
              return direction === "desc" ? -1 : 1;

            const res = valA > valB ? 1 : -1;
            return direction === "desc" ? -res : res;
          });
        },
      });
    }

    let executedSuccessfully = false;
    const fsOps = [...ops];
    const memOps: Op[] = [];
    let snapshot: FirebaseFirestore.QuerySnapshot | null = null;
    let total = 0;

    while (!executedSuccessfully) {
      try {
        let fsQuery: FirebaseFirestore.Query = db.collection("nodes");
        for (const op of fsOps) {
          fsQuery = op.applyFs(fsQuery);
        }

        if (memOps.length === 0) {
          const paginatedQuery = paginate(fsQuery, query);
          const [snap, countSnap] = await Promise.all([
            paginatedQuery.get(),
            fsQuery.count().get(),
          ]);
          snapshot = snap;
          total = countSnap.data().count;
        } else {
          snapshot = await fsQuery.get();
        }
        executedSuccessfully = true;
      } catch (e: any) {
        if (
          e.code === 9 ||
          (e.message && e.message.toLowerCase().includes("index"))
        ) {
          if (fsOps.length === 0) {
            throw e;
          }
          const dropped = fsOps.pop();
          if (dropped) {
            memOps.unshift(dropped);
          }
        } else {
          throw e;
        }
      }
    }

    let nodesArray = snapshot!.docs.map((doc) => {
      const data = doc.data();
      if (data.revision_id) {
        if (typeof data.revision_id.path === "string") {
          data.revision_id = data.revision_id.path;
        } else if (
          data.revision_id._path &&
          Array.isArray(data.revision_id._path.segments)
        ) {
          data.revision_id = data.revision_id._path.segments.join("/");
        }
      }
      return { id: doc.id, ...data, visibility: pageIsPublic(data) };
    });

    for (const op of memOps) {
      nodesArray = op.applyMem(nodesArray);
    }

    if (memOps.length > 0) {
      total = nodesArray.length;
      const page = query.page || 1;
      const limit = query.limit || nodesArray.length;
      const offset = (page - 1) * limit;
      nodesArray = nodesArray.slice(offset, offset + limit);
    }

    const nodesRecord: Record<string, unknown> = {};
    for (const node of nodesArray) {
      nodesRecord[node.id] = node;
    }

    return { nodes: nodesRecord, total };
  }

  // Fallback to the original cached behavior if no limit/sortBy is provided
  return cachedHandler(event);
});
