import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  user: { isSignedIn: true, orgRole: "Admin" },
  get: vi.fn(),
  post: vi.fn(),
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
}));
vi.mock("@grafana/ui", () => ({
  Alert: ({
    title,
    children,
  }: {
    title: string;
    children?: React.ReactNode;
  }) => (
    <div>
      {title}
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
          name: "Iniciar teste",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Iniciar teste" }));
    expect(runtime.post).not.toHaveBeenCalled();
  },
);
test("submits the displayed revision and reserves against repeated submission", async () => {
  let resolvePost: (result: unknown) => void = () => {};
  runtime.post.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvePost = resolve;
      }),
  );
  render(<ControlPage />);
  const input = await screen.findByLabelText("Users *");
  fireEvent.change(input, { target: { value: "3" } });
  const form = screen.getByRole("form", { name: "Configuração do teste" });
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(runtime.post).toHaveBeenCalledTimes(1);
  expect(runtime.post).toHaveBeenCalledWith(expect.stringContaining("/start"), {
    revision: "current",
    scenario: "native",
    values: { user_count: "3" },
  });
  resolvePost({ success: true });
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Iniciar teste",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
});
test("reload recovers active values and the exact persisted report link", async () => {
  runtime.get.mockImplementation(async (path: string) =>
    path.endsWith("catalog")
      ? catalog
      : {
          ...ready,
          phase: "running",
          scenario: "native",
          values: { user_count: "7" },
          context: {
            id: "persisted",
            diagnosticUrl: "/d/report?var-run_id=persisted&from=123",
          },
        },
  );
  render(<ControlPage />);
  const input = (await screen.findByLabelText("Users *")) as HTMLInputElement;
  await waitFor(() => expect(input.value).toBe("7"));
  expect(input.disabled).toBe(true);
  expect(
    screen
      .getByRole("link", { name: "Abrir diagnóstico desta execução" })
      .getAttribute("href"),
  ).toBe("/d/report?var-run_id=persisted&from=123");
  expect(
    (screen.getByRole("button", { name: "Parar teste" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
});
