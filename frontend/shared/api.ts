import type { ElectionPosition } from "~~/shared/model";

export type CompanyRequest = {
  krs: string;
  name: string;
  owners?: string[];
  teryt?: string;
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

export type PersonRequest = {
  name: string;
  content?: string;
  wikipedia?: string;
  rejestrIo?: string;
  party: string[];
  companies?: Array<EmploymentRequest>;
  articles?: Array<ArticleRequest>;
  elections?: Array<ElectionRequest>;
};

export type EntityResult = {
  nodeId: string;
  created: boolean;
  edgeId?: string;
  krs?: string;
};
