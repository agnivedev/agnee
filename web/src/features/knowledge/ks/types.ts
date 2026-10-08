/** Bentuk data dari /v1/ks/*. Cermin dari ksView() di src/server.js. */

export type KsField = {
  key: string;
  label: string;
  type: 'text' | 'money' | 'enum' | 'url';
  required?: boolean;
  requiredWhen?: Record<string, string>;
  max?: number;
  values?: string[];
};

export type KsCategory = {
  key: string;
  title: string;
  help?: string;
  type: 'list' | 'object';
  /** Awalan nomor baris pada daftar berjenjang, misalnya "Tingkat". */
  rowLabel?: string;
  min?: number;
  max?: number;
  fields: KsField[];
};

export type KsRecord = Record<string, string | number | undefined>;
export type KsSpecific = Record<string, KsRecord | KsRecord[] | undefined>;

export type KsCheck = { type: string; tier?: number; ok: boolean | null; detail: string };

export type KsScenario = {
  id: string;
  name: string;
  pass: boolean;
  checks: KsCheck[];
  transcript: { role: 'customer' | 'assistant'; text: string }[];
};

export type KsSimulation = {
  at: string;
  passed: number;
  failed: number;
  scenarios: KsScenario[];
};

export type KsJob = {
  status: 'running' | 'done' | 'failed';
  total: number;
  done: number;
  error?: string;
};

export type KsInstall = {
  id: string;
  code: string;
  name: string;
  summary: string;
  version: string;
  kind: string;
  active: boolean;
  general: { file: string; title: string; content: string }[];
  specificSchema: { categories: KsCategory[] };
  example: KsSpecific | null;
  specific: KsSpecific;
  problems: string[];
  simulation: KsSimulation | null;
  blockedReason: string | null;
  blockedCode: 'problems' | 'no_simulation' | 'failed' | null;
};

export type KsCatalogEntry = {
  code: string;
  name: string;
  version: string;
  kind: string;
  summary: string;
  source: string;
  installed: boolean;
};
