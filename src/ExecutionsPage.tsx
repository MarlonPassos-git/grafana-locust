import { getBackendSrv } from "@grafana/runtime";
import { Alert, Button, LinkButton, Stack, useTheme2 } from "@grafana/ui";
import { useEffect, useState } from "react";
import {
  base,
  type Catalog,
  labels,
  newPath,
  type RecentExecution,
  runDate,
  type State,
} from "./model";

type ExecutionsProps = {
  catalog?: Catalog;
  state?: State;
  pending: boolean;
  canCommand: boolean;
  reuseDisabled: boolean;
  onStop: () => void;
  onReuse: (execution: RecentExecution) => void;
};

export function ExecutionsPage({
  catalog,
  state,
  pending,
  canCommand,
  onStop,
  onReuse,
  reuseDisabled,
}: ExecutionsProps) {
  const theme = useTheme2();
  const cellStyle = {
    padding: theme.spacing(1.5, 2),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    textAlign: "start" as const,
    verticalAlign: "middle" as const,
  };
  const [executions, setExecutions] = useState<RecentExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [retry, setRetry] = useState(0);
  const recentEnabled = catalog?.recentEnabled;
  const phase = state?.phase;
  const runId = state?.context?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Refresh saved records after lifecycle changes and explicit retry.
  useEffect(() => {
    if (!recentEnabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    getBackendSrv()
      .get<{ executions: RecentExecution[]; hasMore?: boolean }>(
        `${base}/recent?page=${page}`,
      )
      .then((result) => {
        if (!cancelled) {
          setExecutions(result.executions);
          setHasMore(!!result.hasMore);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [recentEnabled, page, retry, phase, runId]);
  const active = !!state && !["ready", "finished"].includes(state.phase);
  return (
    <>
      <Stack gap={2} wrap="wrap">
        <LinkButton href={newPath}>Nova execução</LinkButton>
        {catalog?.historyUrl && (
          <LinkButton variant="secondary" href={catalog.historyUrl}>
            Consultar histórico
          </LinkButton>
        )}
      </Stack>
      {active && (
        <section
          aria-label="Execução ativa"
          style={{ marginBlock: "24px", overflowWrap: "anywhere" }}
        >
          <h3>Execução ativa · {labels[state.phase]}</h3>
          <p>
            {state.context?.id ?? "Aguardando identidade do runner"} ·{" "}
            {state.values?.host ?? "Alvo definido no runner"}
          </p>
          <Stack gap={2} wrap="wrap">
            {state.context?.diagnosticUrl && (
              <LinkButton
                variant="secondary"
                href={state.context.diagnosticUrl}
              >
                Abrir dashboard da execução ativa
              </LinkButton>
            )}
            <Button
              type="button"
              variant="destructive"
              disabled={!canCommand || pending || state.phase !== "running"}
              onClick={onStop}
            >
              Parar execução
            </Button>
          </Stack>
        </section>
      )}
      <section
        aria-label="Execuções salvas"
        style={{ marginBlockStart: "24px" }}
      >
        {!catalog ? (
          <p>Carregando execuções…</p>
        ) : !recentEnabled ? (
          <p>
            Histórico não configurado para este runner. A execução ativa pode
            ser controlada aqui.
          </p>
        ) : loading ? (
          <output>Carregando execuções…</output>
        ) : error ? (
          <>
            <Alert
              title="Não foi possível carregar o histórico."
              severity="error"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => setRetry((value) => value + 1)}
            >
              Tentar novamente
            </Button>
          </>
        ) : (
          <>
            {!executions.length ? (
              <p>Nenhuma execução salva nesta página.</p>
            ) : (
              <section
                aria-label="Tabela de execuções salvas"
                // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll the table.
                tabIndex={0}
                style={{
                  overflow: "auto",
                  maxWidth: "100%",
                  maxHeight: "65vh",
                  marginBlockEnd: theme.spacing(2),
                  border: `1px solid ${theme.colors.border.weak}`,
                  borderRadius: theme.shape.radius.default,
                  containerType: "inline-size",
                  containerName: "locust-executions",
                }}
              >
                <style>{`
                  .locust-executions-table tbody th { position: sticky; inset-inline-start: 0; }
                  @container locust-executions (width < 640px) {
                    .locust-executions-table tbody th { position: static; }
                  }
                `}</style>
                <table
                  className="locust-executions-table"
                  aria-label="Execuções salvas"
                  style={{
                    width: "100%",
                    minWidth: "960px",
                    borderCollapse: "separate",
                    borderSpacing: 0,
                  }}
                >
                  <thead
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: 2,
                      background: theme.colors.background.secondary,
                    }}
                  >
                    <tr>
                      {["Execução", "Alvo", "Status", "Ações"].map((label) => (
                        <th
                          key={label}
                          scope="col"
                          style={{
                            ...cellStyle,
                            fontWeight: theme.typography.fontWeightMedium,
                          }}
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {executions.map((execution, index) => {
                      const isActive = execution.id === runId && active;
                      const status = isActive
                        ? labels[state.phase]
                        : !execution.endedAt
                          ? "Em andamento"
                          : execution.passed === true
                            ? "Aprovada"
                            : execution.passed === false
                              ? "Reprovada"
                              : "Encerrada";
                      const color =
                        isActive || !execution.endedAt
                          ? theme.colors.info.text
                          : execution.passed === true
                            ? theme.colors.success.text
                            : execution.passed === false
                              ? theme.colors.error.text
                              : theme.colors.text.secondary;
                      const background =
                        index % 2
                          ? theme.colors.background.secondary
                          : theme.colors.background.primary;
                      return (
                        <tr key={execution.id} style={{ background }}>
                          <th
                            scope="row"
                            style={{
                              ...cellStyle,
                              zIndex: 1,
                              background,
                              width: "280px",
                              minWidth: "280px",
                              fontWeight: "normal",
                            }}
                          >
                            <time
                              dateTime={execution.startedAt}
                              style={{
                                display: "block",
                                whiteSpace: "nowrap",
                                fontWeight: theme.typography.fontWeightMedium,
                              }}
                            >
                              {runDate(execution.startedAt)}
                            </time>
                            <span
                              style={{
                                display: "block",
                                marginBlockStart: theme.spacing(0.5),
                                color: theme.colors.text.secondary,
                                fontSize: "12px",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {execution.id}
                            </span>
                          </th>
                          <td
                            style={{
                              ...cellStyle,
                              overflowWrap: "anywhere",
                              minWidth: "240px",
                            }}
                          >
                            {execution.values.host ?? "Alvo não informado"}
                          </td>
                          <td style={{ ...cellStyle, whiteSpace: "nowrap" }}>
                            <span
                              style={{
                                color,
                                fontWeight: theme.typography.fontWeightMedium,
                              }}
                            >
                              {status}
                            </span>
                          </td>
                          <td style={{ ...cellStyle, minWidth: "280px" }}>
                            <Stack gap={1} wrap="wrap">
                              {execution.diagnosticUrl && (
                                <LinkButton
                                  size="sm"
                                  variant="secondary"
                                  href={execution.diagnosticUrl}
                                >
                                  Abrir dashboard
                                </LinkButton>
                              )}
                              <Button
                                size="sm"
                                type="button"
                                variant="secondary"
                                disabled={
                                  reuseDisabled ||
                                  !catalog.scenarios.some(
                                    (item) => item.id === execution.scenario,
                                  )
                                }
                                aria-label={`Reutilizar configuração de ${runDate(execution.startedAt)}`}
                                onClick={() => onReuse(execution)}
                              >
                                Reutilizar
                              </Button>
                            </Stack>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            )}
            <Stack gap={2} alignItems="center">
              <Button
                type="button"
                variant="secondary"
                disabled={page === 0}
                onClick={() => setPage((value) => value - 1)}
              >
                Anterior
              </Button>
              <output>Página {page + 1}</output>
              <Button
                type="button"
                variant="secondary"
                disabled={!hasMore}
                onClick={() => setPage((value) => value + 1)}
              >
                Próxima
              </Button>
            </Stack>
          </>
        )}
      </section>
    </>
  );
}
