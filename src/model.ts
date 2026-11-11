export type FieldSpec = {
  name: string;
  label: string;
  type: "string" | "url" | "integer" | "number";
  required: boolean;
  default: string;
  min?: number;
  max?: number;
  options?: Array<{ label: string; value: string }>;
};
export type Scenario = { id: string; name: string; fields: FieldSpec[] };
export type Profile = {
  id: string;
  name: string;
  scenario: string;
  values: Record<string, string>;
};
export type RecentExecution = {
  id: string;
  startedAt: string;
  diagnosticUrl: string;
  scenario: string;
  values: Record<string, string>;
  passed: boolean | null;
  endedAt?: string;
};
export type Catalog = {
  scenarios: Scenario[];
  profiles?: Profile[];
  recentEnabled?: boolean;
  historyUrl?: string;
  contextEnabled?: boolean;
};
export type State = {
  context?: {
    id: string;
    diagnosticUrl: string;
    startedAt?: string;
    endedAt?: string;
  };
  values?: Record<string, string>;
  phase: string;
  revision: string;
  scenario?: string;
  stats: { user_count: number; current_rps: number; fail_ratio: number };
  message?: string;
};
export const base = "/api/plugins/locust-control-app/resources";
export const labels: Record<string, string> = {
  unavailable: "Indisponível",
  ready: "Pronto",
  starting: "Iniciando",
  running: "Executando",
  stopping: "Finalizando",
  finished: "Encerrado",
  error: "Erro",
};

export function formValues(
  scenario: Scenario,
  overrides: Record<string, string> = {},
) {
  return Object.fromEntries(
    scenario.fields.map((field) => [
      field.name,
      overrides[field.name] ?? field.default,
    ]),
  );
}

export function runDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("pt-BR");
}
export function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "data" in error) {
    const data = error.data;
    if (
      typeof data === "object" &&
      data !== null &&
      "message" in data &&
      typeof data.message === "string"
    ) {
      return data.message;
    }
  }
  return "Não foi possível consultar o runner. Aguarde a reconexão antes de enviar outro comando.";
}

export const appPath = "/a/locust-control-app";
export const executionsPath = `${appPath}/executions`;
export const newPath = `${appPath}/new`;
