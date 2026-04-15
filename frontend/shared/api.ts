import type { ElectionPosition } from "~~/shared/model";
import { z } from "zod";

export const companyRequestSchema = z.object({
  krs: z.string(),
  name: z.string(),
  owners: z.array(z.string()).optional(),
  teryt: z.string().optional(),
});

export type CompanyRequest = {
  krs: string;
  name: string;
  owners?: string[];
  teryt?: string;
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
