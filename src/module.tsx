import { AppPlugin } from "@grafana/data";
import { config, getBackendSrv } from "@grafana/runtime";
import {
  Alert,
  Button,
  Field,
  Input,
  RadioButtonGroup,
  Select,
  Stack,
} from "@grafana/ui";
import { useEffect, useRef, useState } from "react";

type FieldSpec = {
  name: string;
  label: string;
  type: "string" | "url" | "integer" | "number";
  required: boolean;
  default: string;
  min?: number;
  max?: number;
  options?: Array<{ label: string; value: string }>;
};
type Scenario = { id: string; name: string; fields: FieldSpec[] };
type Profile = {
  id: string;
  name: string;
  scenario: string;
  values: Record<string, string>;
};
type RecentExecution = {
  id: string;
  startedAt: string;
  diagnosticUrl: string;
  scenario: string;
  values: Record<string, string>;
  passed: boolean | null;
};
type Catalog = {
  scenarios: Scenario[];
  profiles?: Profile[];
  recentEnabled?: boolean;
  historyUrl?: string;
};
type State = {
  context?: { id: string; diagnosticUrl: string; endedAt?: string };
  values?: Record<string, string>;
  phase: string;
  revision: string;
  scenario?: string;
  stats: { user_count: number; current_rps: number; fail_ratio: number };
  message?: string;
};
const base = "/api/plugins/locust-control-app/resources";
const labels: Record<string, string> = {
  unavailable: "Indisponível",
  ready: "Pronto",
  starting: "Iniciando",
  running: "Executando",
  stopping: "Finalizando",
  finished: "Encerrado",
  error: "Erro",
};

function formValues(
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

function runDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("pt-BR");
}
function errorMessage(error: unknown): string {
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

export function ControlPage() {
  const [catalog, setCatalog] = useState<Catalog>();
  const [scenarioId, setScenarioId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [state, setState] = useState<State>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [profileId, setProfileId] = useState("");
  const [prefillMessage, setPrefillMessage] = useState("");
  const [recent, setRecent] = useState<RecentExecution[]>([]);
  const [recentError, setRecentError] = useState(false);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentRevision, setRecentRevision] = useState(0);
  const submitting = useRef(false);
  const canCommand =
    config.bootData.user.isSignedIn &&
    ["Editor", "Admin"].includes(config.bootData.user.orgRole);
  const scenario = catalog?.scenarios.find((s) => s.id === scenarioId);
  const ready = state && ["ready", "finished"].includes(state.phase);
  const disabled = !canCommand || pending || !ready;

  useEffect(() => {
    let cancelled = false;
    getBackendSrv()
      .get<Catalog>(`${base}/catalog`)
      .then((result) => {
        if (!cancelled) {
          setCatalog(result);
          const initial = result.scenarios[0];
          if (initial) {
            setScenarioId(initial.id);
            setValues(formValues(initial));
          }
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(errorMessage(e));
        }
      });
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await getBackendSrv().get<State>(`${base}/state`);
        if (!cancelled) {
          setState(result);
        }
      } catch {
        if (!cancelled) {
          setState((previous) =>
            previous ? { ...previous, phase: "unavailable" } : undefined,
          );
        }
      } finally {
        if (!cancelled) {
          timer = setTimeout(poll, 1500);
        }
      }
    }
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (
      catalog &&
      state?.scenario &&
      state.values &&
      ["starting", "running", "stopping"].includes(state.phase)
    ) {
      setScenarioId(state.scenario);
      setValues(state.values);
    }
  }, [state, catalog]);

  const recentEnabled = catalog?.recentEnabled;
  const runId = state?.context?.id;
  const phase = state?.phase;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Refresh persisted history when the run changes phase or the operator retries.
  useEffect(() => {
    if (!recentEnabled) {
      return;
    }
    let cancelled = false;
    setRecentLoading(true);
    setRecentError(false);
    getBackendSrv()
      .get<{ executions: RecentExecution[] }>(`${base}/recent`)
      .then((result) => {
        if (!cancelled) {
          setRecent(result.executions.slice(0, 3));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRecentError(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setRecentLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [recentEnabled, runId, phase, recentRevision]);

  function prefill(
    targetScenario: string,
    overrides: Record<string, string>,
    source: string,
  ) {
    const target = catalog?.scenarios.find(
      (item) => item.id === targetScenario,
    );
    if (!target || disabled) {
      return;
    }
    setScenarioId(target.id);
    setValues(formValues(target, overrides));
    setError("");
    setPrefillMessage(
      `Configuração carregada: ${source}. Revise os valores e clique em Iniciar teste.`,
    );
  }

  async function command(action: "start" | "stop") {
    if (submitting.current || !state) {
      return;
    }
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      await getBackendSrv().post(`${base}/${action}`, {
        revision: state.revision,
        scenario: scenarioId,
        values: action === "start" ? values : undefined,
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      try {
        setState(await getBackendSrv().get<State>(`${base}/state`));
      } catch {
        setError(
          "Runner indisponível. Aguarde a reconexão para conferir o resultado do comando.",
        );
      }
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <section
      aria-label="Controle Locust"
      style={{ padding: "24px", maxWidth: "760px" }}
    >
      <h1>Novo teste</h1>
      <p>Configure o cenário e acompanhe a execução neste runner.</p>
      {!canCommand && (
        <Alert
          title="Entre como Editor ou Admin para iniciar ou parar um teste."
          severity="info"
        />
      )}
      {error && (
        <div role="alert">
          <Alert title="Não foi possível concluir a operação" severity="error">
            {error}
          </Alert>
        </div>
      )}
      <section aria-label="Estado do runner">
        <output aria-live="polite">
          <strong>
            {labels[state?.phase ?? "unavailable"] ?? state?.phase}
          </strong>
          {pending ? " · Enviando comando…" : ""}
        </output>
        {state?.message && (
          <Alert title="Verifique o runner" severity="warning">
            {state.message}
          </Alert>
        )}
        {state && (
          <p>
            Usuários: {state.stats.user_count} · Requisições/s:{" "}
            {state.stats.current_rps.toFixed(1)} · Falhas:{" "}
            {(state.stats.fail_ratio * 100).toFixed(1)}%
          </p>
        )}
      </section>
      {!catalog ? (
        <p>Carregando cenários…</p>
      ) : catalog.scenarios.length === 0 ? (
        <Alert title="Nenhum cenário configurado" severity="warning" />
      ) : (
        <form
          aria-label="Configuração do teste"
          method="post"
          action={`${base}/start`}
          onSubmit={(e) => {
            e.preventDefault();
            void command("start");
          }}
        >
          {!!catalog.profiles?.length && (
            <Field label="Perfil de execução" htmlFor="locust-profile">
              <Select
                inputId="locust-profile"
                name="profile"
                disabled={disabled}
                value={profileId}
                options={[
                  { label: "Selecione um perfil para preencher", value: "" },
                  ...catalog.profiles.map((profile) => ({
                    label: profile.name,
                    value: profile.id,
                  })),
                ]}
                onChange={(option) => {
                  const profile = catalog.profiles?.find(
                    (item) => item.id === option.value,
                  );
                  setProfileId(profile?.id ?? "");
                  if (profile) {
                    prefill(profile.scenario, profile.values, profile.name);
                  }
                }}
              />
            </Field>
          )}
          {catalog.recentEnabled && (
            <section
              aria-labelledby="recent-executions-title"
              style={{ marginBlock: "24px" }}
            >
              <details>
                <summary
                  id="recent-executions-title"
                  style={{ cursor: "pointer" }}
                >
                  Últimas execuções ({recent.length})
                </summary>
                <p>
                  Reutilize os parâmetros de uma das três últimas execuções
                  encerradas.
                </p>
                {recentLoading && <output>Carregando execuções…</output>}
                {recentError ? (
                  <div>
                    <output>Não foi possível carregar o histórico.</output>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        setRecentRevision((revision) => revision + 1)
                      }
                    >
                      Tentar novamente
                    </Button>
                  </div>
                ) : !recentLoading && recent.length === 0 ? (
                  <p>
                    Após encerrar um teste, sua configuração aparecerá aqui.
                  </p>
                ) : (
                  <ol style={{ paddingInlineStart: "20px" }}>
                    {recent.map((execution) => (
                      <li
                        key={execution.id}
                        style={{
                          marginBlockEnd: "16px",
                          overflowWrap: "anywhere",
                        }}
                      >
                        <strong>
                          {runDate(execution.startedAt)} ·{" "}
                          {execution.passed === true
                            ? "Aprovada"
                            : execution.passed === false
                              ? "Reprovada"
                              : "Encerrada"}
                        </strong>
                        <p>
                          {execution.values.host} · SKU{" "}
                          {execution.values.sku ?? "—"} ·{" "}
                          {execution.values.total ?? "—"} jornadas · Pagamento{" "}
                          {execution.values.payment_system === "125"
                            ? "Pix"
                            : execution.values.payment_system === "6"
                              ? "Boleto"
                              : (execution.values.payment_system ?? "—")}
                        </p>
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "16px",
                            alignItems: "center",
                          }}
                        >
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={
                              disabled ||
                              !catalog.scenarios.some(
                                (item) => item.id === execution.scenario,
                              )
                            }
                            aria-label={`Usar configuração de ${runDate(execution.startedAt)}`}
                            onClick={() => {
                              setProfileId("");
                              prefill(
                                execution.scenario,
                                execution.values,
                                runDate(execution.startedAt),
                              );
                            }}
                          >
                            Usar configuração
                          </Button>
                          <a href={execution.diagnosticUrl}>Ver relatório</a>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </details>
            </section>
          )}
          <output style={{ display: "block", marginBlock: "16px" }}>
            {prefillMessage}
          </output>
          <Field label="Cenário" htmlFor="locust-scenario">
            <Select
              inputId="locust-scenario"
              name="scenario"
              disabled={disabled}
              value={scenarioId}
              options={catalog.scenarios.map((s) => ({
                label: s.name,
                value: s.id,
              }))}
              onChange={(option) => {
                const id = option.value ?? "";
                setScenarioId(id);
                setProfileId("");
                setPrefillMessage("");
                const target = catalog.scenarios.find((s) => s.id === id);
                setValues(target ? formValues(target) : {});
              }}
            />
          </Field>
          {scenario?.fields.map((field) =>
            field.options?.length ? (
              <fieldset
                key={field.name}
                disabled={disabled}
                style={{ border: 0, padding: 0, marginBlockEnd: "16px" }}
              >
                <legend style={{ fontSize: "12px", marginBlockEnd: "8px" }}>
                  {field.label + (field.required ? " *" : "")}
                </legend>
                <RadioButtonGroup
                  aria-label={field.label}
                  id={`locust-${field.name}`}
                  options={field.options}
                  value={values[field.name] ?? ""}
                  disabled={disabled}
                  onChange={(value) => {
                    setProfileId("");
                    setValues({ ...values, [field.name]: value });
                  }}
                />
              </fieldset>
            ) : (
              <Field
                key={field.name}
                label={field.label + (field.required ? " *" : "")}
                htmlFor={`locust-${field.name}`}
              >
                <Input
                  id={`locust-${field.name}`}
                  name={field.name}
                  disabled={disabled}
                  required={field.required}
                  maxLength={2048}
                  type={
                    field.type === "integer" || field.type === "number"
                      ? "number"
                      : field.type === "url"
                        ? "url"
                        : "text"
                  }
                  min={field.min}
                  max={field.max}
                  step={field.type === "integer" ? 1 : "any"}
                  value={values[field.name] ?? ""}
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                  onChange={(e) => {
                    setProfileId("");
                    setValues({
                      ...values,
                      [field.name]: e.currentTarget.value,
                    });
                  }}
                />
              </Field>
            ),
          )}
          <Stack gap={2}>
            <Button type="submit" disabled={disabled}>
              Iniciar teste
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!canCommand || pending || state?.phase !== "running"}
              onClick={() => void command("stop")}
            >
              Parar teste
            </Button>
          </Stack>
        </form>
      )}
      {state?.context?.diagnosticUrl && (
        <p>
          <a href={state.context.diagnosticUrl}>
            Abrir diagnóstico desta execução
          </a>
        </p>
      )}
      {state?.phase === "starting" && (
        <p>
          Aguardando confirmação do runner e da identidade da nova execução.
        </p>
      )}
      {catalog?.historyUrl && (
        <p>
          <a href={catalog.historyUrl}>Consultar histórico</a>
        </p>
      )}
    </section>
  );
}
export const plugin = new AppPlugin().setRootPage(ControlPage);
