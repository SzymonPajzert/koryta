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

export const personRequestSchema = z.object({
  name: z.string(),
  content: z.string().optional(),
  wikipedia: z.string().optional(),
  rejestrIo: z.string().optional(),
  party: z.string().optional(),
  companies: z.array(z.any()).optional(),
  articles: z.array(z.any()).optional(),
  elections: z.array(z.any()).optional(),
});

export type PersonRequest = {
  name: string;
  content?: string;
  wikipedia?: string;
  rejestrIo?: string;
  party?: string;
  companies?: Array<EmploymentRequest>;
  articles?: Array<ArticleRequest>;
  elections?: Array<ElectionRequest>;
};

export type EmploymentRequest = CompanyRequest & {
  role?: string;
  start?: string;
  end?: string;
};

export type ArticleRequest = {
  url: string;
};

export type ElectionRequest = {
  party?: string;
  election_year?: string;
  election_type: ElectionPosition;
  teryt?: string;
};

export type EntityResult = {
  nodeId: string;
  created: boolean;
  edgeId?: string;
  krs?: string;
};
