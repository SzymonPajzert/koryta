import type { ElectionPosition, Person } from "./model";
import { z } from "zod";

export const companyRequestSchema = z.object({
  krs: z.string(),
  name: z.string(),
  owners: z.array(z.string()).optional(),
  teryt: z.string().optional(),
  /** PKD codes from KRS, e.g. "86.10.Z" */
  activity: z.array(z.string()).optional(),
});

export type CompanyRequest = {
  krs: string;
  name: string;
  owners?: string[];
  teryt?: string;
  activity?: string[];
};

const employmentRequestSchema = z.object({
  krs: z.string(),
  role: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
});

export type EmploymentRequest = {
  krs: string;
  role?: string;
  start?: string;
  end?: string;
};

const electionRequestSchema = z.object({
  party: z.string().optional(),
  election_year: z.string().optional(),
  election_type: z.enum([
    "Samorząd",
    "Sejmik",
    "Rada miasta",
    "Rada gminy",
    "Rada powiatu",
    "Burmistrz",
    "Wójt",
    "Prezydent",
    "Sejm",
    "Senat",
    "Parlament Europejski",
  ]),
  teryt: z.string().optional(),
});

export type ElectionRequest = {
  party?: string;
  election_year?: string;
  election_type: ElectionPosition;
  teryt?: string;
};

export const personRequestSchema = z.object({
  name: z.string(),
  content: z.string().optional(),
  autoapprove: z.boolean().optional(),

  wikipedia: z.string().optional(),
  rejestrIo: z.string().optional(),
  parties: z.array(z.string()).optional(),
  sources: z.array(z.string()).optional(),
  companies: z.array(employmentRequestSchema),
  elections: z.array(electionRequestSchema).optional(),
});

export type PersonRequest = {
  name: string;
  content?: string;
  autoapprove?: boolean;

  wikipedia?: string;
  rejestrIo?: string;
  parties?: Array<string>;
  sources?: Array<string>;
  companies: Array<EmploymentRequest>;
  elections?: Array<ElectionRequest>;
};

export type EntityResult = {
  nodeId: string;
  created: boolean;
  edgeId?: string;
  krs?: string;
};

/** Fields a user may propose for a person node, whether creating a new one
 * or editing an existing one. Only person nodes are supported for now.
 *
 * This is an allowlist rather than a denylist of internal fields: anything
 * not listed here is stripped by zod during parsing, so a caller can't smuggle
 * in e.g. `revision_id` or `stats` and have it written straight to the node.
 *
 * The `satisfies` clause couples this to the `Person` model: if a listed
 * field's type changes there, this schema stops typechecking until updated,
 * so the two can't silently drift apart.
 */
export const personEditSchema = z.object({
  name: z.string().min(1, "Nazwa jest wymagana"),
  content: z.string().optional(),
  parties: z.array(z.string()).optional(),
  wikipedia: z.string().optional(),
  rejestrIo: z.string().optional(),
}) satisfies z.ZodType<
  Pick<Person, "name" | "content" | "parties" | "wikipedia" | "rejestrIo">
>;

export type PersonEditRequest = z.infer<typeof personEditSchema>;
