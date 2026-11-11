import { AppPlugin } from "@grafana/data";
import {
  config,
  getBackendSrv,
  locationService,
  PluginPage,
} from "@grafana/runtime";
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

import { ExecutionsPage } from "./ExecutionsPage";
import {
  appPath,
  base,
  type Catalog,
  errorMessage,
  executionsPath,
  formValues,
  labels,
  newPath,
  runDate,
  type State,
} from "./model";

export function ControlPage() {
  const [location, setLocation] = useState(locationService.getLocation());
  const [catalog, setCatalog] = useState<Catalog>();
  const [scenarioId, setScenarioId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [state, setState] = useState<State>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [awaitingIdentity, setAwaitingIdentity] = useState(false);
  const [profileId, setProfileId] = useState("");
  const [prefillMessage, setPrefillMessage] = useState("");
  const submitting = useRef(false);
  const confirmation = useRef<{ previousId?: string } | null>(null);
  const newExecution = location.pathname.replace(/\/$/, "") === newPath;
  const canCommand =
    config.bootData.user.isSignedIn &&
    ["Editor", "Admin"].includes(config.bootData.user.orgRole);
  const scenario = catalog?.scenarios.find((s) => s.id === scenarioId);
  const ready = state && ["ready", "finished"].includes(state.phase);
  const disabled = !canCommand || pending || awaitingIdentity || !ready;

  useEffect(() => locationService.getHistory().listen(setLocation), []);
  useEffect(() => {
    if (location.pathname.replace(/\/$/, "") === appPath) {
      locationService.replace(executionsPath);
    }
  }, [location.pathname]);

  useEffect(() => {
    let cancelled = false;
    getBackendSrv()
      .get<Catalog>(`${base}/catalog`)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setCatalog(result);
        const initial = result.scenarios[0];
        if (initial) {
          setScenarioId(initial.id);
          setValues(formValues(initial));
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
    const waiting = confirmation.current;
    if (!waiting || !state || !catalog) {
      return;
    }
    if (catalog.contextEnabled) {
      if (
        !state.context?.id ||
        state.context.id === waiting.previousId ||
        !state.context.diagnosticUrl ||
        ["error", "unavailable"].includes(state.phase)
      ) {
        return;
      }
      confirmation.current = null;
      setAwaitingIdentity(false);
      const url = new URL(state.context.diagnosticUrl, window.location.origin);
      if (url.origin === window.location.origin) {
        locationService.push(url.pathname + url.search + url.hash);
      } else {
        window.location.assign(url.href);
      }
    } else if (["running", "stopping", "finished"].includes(state.phase)) {
      confirmation.current = null;
      setAwaitingIdentity(false);
      locationService.push(executionsPath);
    }
  }, [state, catalog]);

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
      `Configuração carregada: ${source}. Revise os valores e clique em Iniciar execução.`,
    );
  }

  async function command(action: "start" | "stop") {
    if (
      submitting.current ||
      !state ||
      !canCommand ||
      (action === "start" ? disabled : state.phase !== "running")
    ) {
      return;
    }
    submitting.current = true;
    setPending(true);
    setError("");
    const previousId = state.context?.id;
    try {
      await getBackendSrv().post(`${base}/${action}`, {
        revision: state.revision,
        scenario: scenarioId,
        values: action === "start" ? values : undefined,
      });
      if (action === "start") {
        confirmation.current = { previousId };
        setAwaitingIdentity(true);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      try {
        setState(await getBackendSrv().get<State>(`${base}/state`));
      } catch {
        setState((previous) =>
          previous ? { ...previous, phase: "unavailable" } : undefined,
        );
        setError(
          "Runner indisponível. Aguarde a reconexão para conferir o resultado do comando.",
        );
      }
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <PluginPage
      pageNav={{
        text: newExecution ? "Nova execução" : "Execuções",
        url: newExecution ? newPath : executionsPath,
      }}
    >
      <section aria-label="Controle Locust" style={{ maxWidth: "1200px" }}>
        {!canCommand && (
          <Alert
            title="Entre como Editor ou Admin para iniciar ou parar uma execução."
            severity="info"
          />
        )}
        {error && (
          <div role="alert">
            <Alert
              title="Não foi possível concluir a operação"
              severity="error"
            >
              {error}
            </Alert>
          </div>
        )}
        <output
          aria-live="polite"
          style={{ display: "block", marginBlockEnd: "16px" }}
        >
          Runner:{" "}
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
        {awaitingIdentity && (
          <Alert
            title="Aguardando confirmação da nova execução"
            severity="info"
          >
            O dashboard abrirá após a confirmação da identidade. O comando não
            será reenviado.
          </Alert>
        )}
        {newExecution ? (
          <>
            <p>
              Configure o cenário. Ao iniciar, acompanhe a execução no
              dashboard.
            </p>
            {!ready && (
              <Alert title="Formulário bloqueado" severity="info">
                Aguarde o runner ficar pronto e concluir a finalização. Controle
                a execução em <a href={executionsPath}>Execuções</a>.
              </Alert>
            )}
            {!catalog ? (
              <p>Carregando cenários…</p>
            ) : !catalog.scenarios.length ? (
              <Alert title="Nenhum cenário configurado" severity="warning" />
            ) : (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "32px",
                  alignItems: "flex-start",
                }}
              >
                <form
                  aria-label="Configuração da execução"
                  method="post"
                  action={`${base}/start`}
                  style={{ flex: "2 1 420px", minWidth: 0, maxWidth: "100%" }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void command("start");
                  }}
                >
                  <output
                    aria-live="polite"
                    style={{ display: "block", marginBlockEnd: "16px" }}
                  >
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
                        const target = catalog.scenarios.find(
                          (s) => s.id === id,
                        );
                        setValues(target ? formValues(target) : {});
                      }}
                    />
                  </Field>
                  {scenario?.fields.map((field) =>
                    field.options?.length ? (
                      <fieldset
                        key={field.name}
                        disabled={disabled}
                        style={{
                          border: 0,
                          padding: 0,
                          marginBlockEnd: "16px",
                        }}
                      >
                        <legend
                          style={{ fontSize: "12px", marginBlockEnd: "8px" }}
                        >
                          {field.label + (field.required ? " *" : "")}
                        </legend>
                        <RadioButtonGroup
                          style={{ flexWrap: "wrap", gap: "4px" }}
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

                  <Button type="submit" disabled={disabled}>
                    Iniciar execução
                  </Button>
                </form>
                {!!catalog.profiles?.length && (
                  <aside
                    aria-label="Perfis de execução"
                    style={{ flex: "1 1 240px", minWidth: 0 }}
                  >
                    <h3>Perfis de execução</h3>
                    <p>
                      Aplique um perfil e revise os parâmetros antes de iniciar.
                    </p>
                    <Stack direction="column" gap={2}>
                      {catalog.profiles.map((profile) => (
                        <Button
                          key={profile.id}
                          type="button"
                          variant={
                            profileId === profile.id ? "primary" : "secondary"
                          }
                          disabled={disabled}
                          style={{
                            whiteSpace: "normal",
                            height: "auto",
                            minHeight: "32px",
                            textAlign: "start",
                          }}
                          aria-pressed={profileId === profile.id}
                          onClick={() => {
                            prefill(
                              profile.scenario,
                              profile.values,
                              profile.name,
                            );
                            setProfileId(profile.id);
                          }}
                        >
                          <span
                            style={{
                              whiteSpace: "normal",
                              overflowWrap: "anywhere",
                              paddingBlock: "6px",
                            }}
                          >
                            {profile.name}
                          </span>
                        </Button>
                      ))}
                    </Stack>
                  </aside>
                )}
              </div>
            )}
          </>
        ) : (
          <ExecutionsPage
            catalog={catalog}
            state={state}
            pending={pending}
            canCommand={canCommand}
            onStop={() => void command("stop")}
            onReuse={(execution) => {
              setProfileId("");
              prefill(
                execution.scenario,
                execution.values,
                runDate(execution.startedAt),
              );
              locationService.push(newPath);
            }}
            reuseDisabled={disabled}
          />
        )}
      </section>
    </PluginPage>
  );
}

export const plugin = new AppPlugin().setRootPage(ControlPage);
