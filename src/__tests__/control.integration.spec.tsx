import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  user: { isSignedIn: true, orgRole: "Admin" },
  get: vi.fn(),
  post: vi.fn(),
  location: { pathname: "/a/locust-control-app/new" },
  listeners: new Set<(location: { pathname: string }) => void>(),
  push: vi.fn(),
}));
vi.mock("@grafana/data", () => ({
  AppPlugin: class {
    setRootPage() {
      return this;
    }
  },
}));
vi.mock("@grafana/runtime", () => ({
  config: { bootData: { user: runtime.user } },
  getBackendSrv: () => ({ get: runtime.get, post: runtime.post }),
  locationService: {
    getLocation: () => runtime.location,
    getHistory: () => ({
      listen: (callback: (location: { pathname: string }) => void) => {
        runtime.listeners.add(callback);
        return () => runtime.listeners.delete(callback);
      },
    }),
    push: (path: string) => {
      runtime.push(path);
      runtime.location = { pathname: path };
      for (const callback of runtime.listeners) {
        callback(runtime.location);
      }
    },
    replace: (path: string) => {
      runtime.location = { pathname: path };
      for (const callback of runtime.listeners) {
        callback(runtime.location);
      }
    },
  },
  PluginPage: ({
    children,
    pageNav,
  }: {
    children: React.ReactNode;
    pageNav: { text: string };
  }) => (
    <main>
      <h1>{pageNav.text}</h1>
      {children}
    </main>
  ),
}));
vi.mock("@grafana/ui", () => ({
  useTheme2: () => ({
    spacing: (...values: number[]) =>
      values.map((value) => `${value * 8}px`).join(" "),
    shape: { radius: { default: "4px" } },
    typography: { fontWeightMedium: 500 },
    colors: {
      border: { weak: "#444" },
      background: { primary: "#111", secondary: "#222" },
      text: { secondary: "#aaa" },
      info: { text: "#8af" },
      success: { text: "#8d8" },
      error: { text: "#f88" },
    },
  }),
  LinkButton: ({
    variant,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: string }) => (
    <a {...props} />
  ),
  Alert: ({
    title,
    children,
  }: {
    title: string;
    children?: React.ReactNode;
  }) => (
    <div>
      <span>{title}</span>
      {children}
    </div>
  ),
  Button: ({
    variant,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => (
    <button {...props} />
  ),
  Field: ({
    label,
    htmlFor,
    children,
  }: {
    label: string;
    htmlFor: string;
    children: React.ReactNode;
  }) => (
    <div>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  ),
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
  RadioButtonGroup: ({
    options,
    value,
    onChange,
    disabled,
  }: {
    options: Array<{ label: string; value: string }>;
    value: string;
    onChange: (value: string) => void;
    disabled: boolean;
  }) => (
    <div>
      {options.map((option) => (
        <label key={option.value}>
          <input
            type="radio"
            checked={value === option.value}
            disabled={disabled}
            onChange={() => onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </div>
  ),
  Select: ({
    inputId,
    options,
    value,
    onChange,
    ...props
  }: {
    inputId: string;
    options: Array<{ label: string; value: string }>;
    value: string;
    onChange: (value: { value: string }) => void;
  }) => (
    <select
      id={inputId}
      value={value}
      onChange={(e) => onChange({ value: e.target.value })}
      {...props}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
  Stack: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { ControlPage } from "../module";

const catalog = {
  scenarios: [
    {
      id: "native",
      name: "Native",
      fields: [
        {
          name: "user_count",
          label: "Users",
          type: "integer",
          required: true,
          default: "2",
          min: 1,
        },
      ],
    },
  ],
};
const ready = {
  phase: "ready",
  revision: "current",
  stats: { user_count: 0, current_rps: 0, fail_ratio: 0 },
};
beforeEach(() => {
  runtime.location = { pathname: "/a/locust-control-app/new" };
  runtime.user.isSignedIn = true;
  runtime.user.orgRole = "Admin";
  runtime.get.mockImplementation(async (path: string) =>
    path.endsWith("catalog") ? catalog : ready,
  );
  runtime.post.mockResolvedValue({ success: true });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const profiles = [
  {
    id: "gradual",
    name: "Gradual",
    scenario: "native",
    values: { user_count: "5" },
  },
];
function execution(id: string) {
  return {
    id,
    startedAt: "2026-11-10T15:00:00Z",
    endedAt: "2026-11-10T15:01:00Z",
    diagnosticUrl: `/d/report?var-run_id=${id}`,
    scenario: "native",
    values: { user_count: "8", removed_field: "discard" },
    passed: false,
  };
}
function setupHistory() {
  runtime.location = { pathname: "/a/locust-control-app/executions" };
  runtime.get.mockImplementation(async (path: string) => {
    if (path.endsWith("catalog")) {
      return { ...catalog, profiles, recentEnabled: true };
    }
    if (path.includes("recent")) {
      return {
        executions: [
          execution("latest"),
          execution("older"),
          execution("third"),
          execution("fourth"),
        ],
        hasMore: true,
      };
    }
    return ready;
  });
}

test.each([false, true])(
  "Viewer cannot submit commands (authenticated: %s)",
  async (isSignedIn) => {
    runtime.user.isSignedIn = isSignedIn;
    runtime.user.orgRole = "Viewer";
    render(<ControlPage />);
    await screen.findByLabelText("Users *");
    expect(
      (
        screen.getByRole("button", {
          name: "Iniciar execução",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.submit(screen.getByRole("form"));
    expect(runtime.post).not.toHaveBeenCalled();
  },
);

test("submits displayed revision once and waits for confirmation", async () => {
  let resolvePost: (result: unknown) => void = () => {};
  runtime.post.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvePost = resolve;
      }),
  );
  render(<ControlPage />);
  fireEvent.change(await screen.findByLabelText("Users *"), {
    target: { value: "3" },
  });
  fireEvent.submit(screen.getByRole("form"));
  fireEvent.submit(screen.getByRole("form"));
  expect(runtime.post).toHaveBeenCalledTimes(1);
  expect(runtime.post).toHaveBeenCalledWith(expect.stringContaining("/start"), {
    revision: "current",
    scenario: "native",
    values: { user_count: "3" },
  });
  resolvePost({ success: true });
  await screen.findByText("Aguardando confirmação da nova execução");
  expect(runtime.push).not.toHaveBeenCalled();
});

test("default route opens executions and saved records beyond three can be reused", async () => {
  setupHistory();
  runtime.location = { pathname: "/a/locust-control-app" };
  render(<ControlPage />);
  await screen.findByRole("heading", { name: "Execuções" });
  const table = await screen.findByRole("table", { name: "Execuções salvas" });
  expect(
    within(table)
      .getAllByRole("columnheader")
      .map((header) => header.textContent),
  ).toEqual(["Execução", "Alvo", "Status", "Ações"]);
  expect(
    within(table)
      .getAllByRole("rowheader")
      .some((header) => header.textContent?.includes("fourth")),
  ).toBe(true);
  const dashboards = await screen.findAllByRole("link", {
    name: "Abrir dashboard",
  });
  expect(dashboards.map((link) => link.getAttribute("href"))).toContain(
    "/d/report?var-run_id=fourth",
  );
  fireEvent.click(
    screen.getAllByRole("button", { name: /Reutilizar configuração de/ })[3],
  );
  await screen.findByRole("heading", { name: "Nova execução" });
  expect((screen.getByLabelText("Users *") as HTMLInputElement).value).toBe(
    "8",
  );
  expect(runtime.post).not.toHaveBeenCalled();
  expect(screen.queryByRole("link", { name: "Abrir dashboard" })).toBeNull();
  fireEvent.submit(screen.getByRole("form"));
  await waitFor(() =>
    expect(runtime.post).toHaveBeenCalledWith(
      expect.stringContaining("/start"),
      { revision: "current", scenario: "native", values: { user_count: "8" } },
    ),
  );
});

test("profiles prefill values for review without starting", async () => {
  runtime.get.mockImplementation(async (path: string) =>
    path.endsWith("catalog") ? { ...catalog, profiles } : ready,
  );
  render(<ControlPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Gradual" }));
  expect((screen.getByLabelText("Users *") as HTMLInputElement).value).toBe(
    "5",
  );
  expect(runtime.post).not.toHaveBeenCalled();
});

test.each(["starting", "running", "stopping", "unavailable", "error"])(
  "busy runner blocks configuration and profiles without replacing draft: %s",
  async (phase) => {
    runtime.get.mockImplementation(async (path: string) =>
      path.endsWith("catalog")
        ? { ...catalog, profiles }
        : {
            ...ready,
            phase,
            values: { user_count: "7" },
            scenario: "native",
            context: { id: "old", diagnosticUrl: "/d/old" },
          },
    );
    render(<ControlPage />);
    const input = (await screen.findByLabelText("Users *")) as HTMLInputElement;
    expect(input.value).toBe("2");
    expect(input.disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Gradual" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Parar execução" })).toBeNull();
    expect(screen.queryByRole("link", { name: /dashboard/ })).toBeNull();
  },
);

test("active execution can be stopped once with its revision", async () => {
  setupHistory();
  runtime.get.mockImplementation(async (path: string) =>
    path.endsWith("catalog")
      ? catalog
      : {
          ...ready,
          phase: "running",
          context: { id: "active", diagnosticUrl: "/d/active" },
        },
  );
  render(<ControlPage />);
  const stop = await screen.findByRole("button", { name: "Parar execução" });
  fireEvent.click(stop);
  fireEvent.click(stop);
  await waitFor(() => expect(runtime.post).toHaveBeenCalledTimes(1));
  expect(runtime.post).toHaveBeenCalledWith(expect.stringContaining("/stop"), {
    revision: "current",
    scenario: "native",
    values: undefined,
  });
});

test("pagination fetches subsequent records without commands", async () => {
  setupHistory();
  render(<ControlPage />);
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Próxima" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
  await waitFor(() =>
    expect(runtime.get).toHaveBeenCalledWith(
      expect.stringContaining("/recent?page=1"),
    ),
  );
  await screen.findByText("Página 2");
  expect(runtime.post).not.toHaveBeenCalled();
});

test("history failure can be retried", async () => {
  setupHistory();
  const previous = runtime.get.getMockImplementation();
  runtime.get.mockImplementation(async (path: string) => {
    if (path.includes("recent")) {
      throw new Error("unavailable");
    }
    return previous?.(path);
  });
  render(<ControlPage />);
  await screen.findByText("Não foi possível carregar o histórico.");
  if (previous) {
    runtime.get.mockImplementation(previous);
  }
  fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
  await screen.findAllByRole("link", { name: "Abrir dashboard" });
  expect(runtime.post).not.toHaveBeenCalled();
});

test("redirect waits for new persisted identity even when prior context remains", async () => {
  let current = {
    ...ready,
    phase: "finished",
    context: { id: "old", diagnosticUrl: "/d/old" },
  };
  runtime.get.mockImplementation(async (path: string) =>
    path.endsWith("catalog") ? { ...catalog, contextEnabled: true } : current,
  );
  render(<ControlPage />);
  await screen.findByLabelText("Users *");
  fireEvent.submit(screen.getByRole("form"));
  await screen.findByText("Aguardando confirmação da nova execução");
  expect(runtime.push).not.toHaveBeenCalled();
  current = {
    ...current,
    phase: "running",
    context: { id: "new", diagnosticUrl: "/d/report?var-run_id=new" },
  };
  await waitFor(
    () => expect(runtime.push).toHaveBeenCalledWith("/d/report?var-run_id=new"),
    { timeout: 3000 },
  );
  expect(runtime.post).toHaveBeenCalledTimes(1);
});

test("failed start never redirects or retries even when new context is observed", async () => {
  let started = false;
  runtime.post.mockImplementation(async () => {
    started = true;
    throw { data: { message: "Comando de resultado desconhecido" } };
  });
  runtime.get.mockImplementation(async (path: string) =>
    path.endsWith("catalog")
      ? { ...catalog, contextEnabled: true }
      : started
        ? {
            ...ready,
            phase: "running",
            context: { id: "new", diagnosticUrl: "/d/new" },
          }
        : ready,
  );
  render(<ControlPage />);
  await screen.findByLabelText("Users *");
  fireEvent.submit(screen.getByRole("form"));
  await screen.findByText("Comando de resultado desconhecido");
  expect(runtime.push).not.toHaveBeenCalled();
  expect(runtime.post).toHaveBeenCalledTimes(1);
});

test("native runner without persisted context returns to execution controls", async () => {
  let started = false;
  runtime.post.mockImplementation(async () => {
    started = true;
    return { success: true };
  });
  runtime.get.mockImplementation(async (path: string) =>
    path.endsWith("catalog")
      ? catalog
      : { ...ready, phase: started ? "running" : "ready" },
  );
  render(<ControlPage />);
  await screen.findByLabelText("Users *");
  fireEvent.submit(screen.getByRole("form"));
  await screen.findByRole("button", { name: "Parar execução" });
  expect(runtime.push).toHaveBeenCalledWith("/a/locust-control-app/executions");
});

test("payment choices submit the configured option value", async () => {
  runtime.get.mockImplementation(async (path: string) =>
    path.endsWith("catalog")
      ? {
          scenarios: [
            {
              id: "checkout",
              name: "Checkout",
              fields: [
                {
                  name: "payment_system",
                  label: "Pagamento",
                  type: "string",
                  required: true,
                  default: "125",
                  options: [
                    { label: "Pix", value: "125" },
                    { label: "Boleto", value: "6" },
                  ],
                },
              ],
            },
          ],
        }
      : ready,
  );
  render(<ControlPage />);
  fireEvent.click(await screen.findByLabelText("Boleto"));
  fireEvent.submit(screen.getByRole("form"));
  await waitFor(() =>
    expect(runtime.post).toHaveBeenCalledWith(
      expect.stringContaining("/start"),
      {
        revision: "current",
        scenario: "checkout",
        values: { payment_system: "6" },
      },
    ),
  );
});
