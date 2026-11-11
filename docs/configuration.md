# Configuration

## Native example

The standalone example in `examples/native` builds Grafana with the plugin and starts Locust against an internal nginx target. In that directory, set the local admin password before starting Compose:

```sh
export GRAFANA_ADMIN_PASSWORD='replace-with-your-local-password'
docker compose up -d --build
```

Open http://localhost:3100/a/locust-control-app and sign in as `admin` with that password. Compose starts idle. Locust and the target do not publish host ports. The quick and gradual scenarios are defined in [the example provisioning file](../examples/native/provisioning/locust.yaml).

## Runner and scenarios

Configure the App through Grafana provisioning. Its `jsonData` accepts a runner address and scenario catalog:

```json
{
  "runnerUrl": "http://locust:8089",
  "scenarios": [{
    "id": "native",
    "name": "HTTP",
    "fixed": {},
    "fields": [
      {"name": "host", "label": "Host", "type": "url", "required": true, "default": "http://target"},
      {"name": "user_count", "label": "Users", "type": "integer", "required": true, "default": "1", "min": 1},
      {"name": "spawn_rate", "label": "Users/s", "type": "number", "required": true, "default": "1", "min": 0.01},
      {"name": "run_time", "label": "Duration", "type": "string", "default": "10s"}
    ]
  }]
}
```

Field names must match the native or custom parameters accepted by `/swarm`. Editable fields support `string`, `url`, `integer` and `number`, with `required`, `default`, `min` and `max` constraints. To offer a fixed set of choices, add `options`, for example `[{"label": "Pix", "value": "125"}, {"label": "Boleto", "value": "6"}]`. The backend checks the registered choices as well as types and bounds. Additional business rules remain in the Locust scenario.

Use `fixed` for parameters users cannot edit. For a runner with `--class-picker`, select the class and shape in the catalog, for example `"fixed": {"user_classes": "Visitor", "shape_class": "Default"}`. For a custom shape, use its registered runner name. The runner owns the scripts and their business rules; the plugin does not accept script uploads from the browser.

## Shared profiles

Define shared profiles in `jsonData.profiles`:

```json
[{"id": "gradual", "name": "Gradual load", "scenario": "native", "values": {"user_count": "3", "spawn_rate": "1"}}]
```

Each profile references an existing scenario and its registered editable fields. Omitted fields receive their defaults. Invalid or unknown fields prevent the configuration from loading. Selecting a profile fills the form; users can edit it before starting an execution.

## Execution context and history

Both integrations are optional runner endpoints. Native Locust control works without them.

### Execution context

Set `contextPath` to a runner path such as `/execution-context`. The endpoint returns JSON with `id`, `startedAt`, `endedAt` and optional `diagnosticUrl`, `scenario` and `values`. Keep `endedAt` null while active and populate it only after persistence and reports have finished.

The consuming project owns the execution identity. After starting, the controller discards the previous context and waits for a new identity before opening its dashboard. It never uses its local control revision as a persisted Locust ID. Without execution context, a confirmed start opens the executions page for monitoring and stopping.

### Saved executions

Set `recentPath` to a runner path such as `/recent-executions` that returns:

```json
{"executions": [{"id": "2026-11-10T18:00:00+00:00", "startedAt": "2026-11-10T18:00:00+00:00", "diagnosticUrl": "/d/report?run=example", "scenario": "native", "values": {"host": "http://target", "user_count": "3"}, "passed": true}]}
```

The plugin sends `?page=0`, incrementing the page as users navigate. Valid page values are integers from 0 to 1000000. The consumer queries its stored history, including active executions, and returns a page ordered newest first, with `hasMore: true` when another page exists. `endedAt` is null while an execution is active; `passed` may be null. The checkout integration uses pages of 20; the plugin has no three-record limit.

Reusing an execution opens the form with the current scenario fields and defaults for review. Starting remains explicit. Without `recentPath`, the executions page reports that history is not configured and keeps native runner controls available. Failed history queries can be retried.

## Authorization and resource API

The plugin exposes `GET /catalog`, `GET /state`, `GET /recent`, `POST /start` and `POST /stop` as Grafana resources. Commands require an authenticated Editor or Admin identity forwarded by Grafana through the SDK. Arbitrary browser headers do not grant permission.

Command bodies contain `revision` from `/state`; start also accepts `scenario` and `values`. Unknown fields are rejected. The backend rejects commands with an outdated revision to protect against stale browser tabs.

## Recovery and limitations

The controller reserves the runner before starting and recovers its state through the API. The active execution appears above the saved history with a stop action. The form and profiles remain locked until finalization completes, preserving the entered values.

If a command's result is ambiguous, the controller keeps the reservation until it observes the execution running and ending. It does not retry the POST automatically. If the request never reached the runner, operator intervention may be needed: confirm that no load is running and no start request is pending before recreating the Grafana backend.

After a successful start, dashboard navigation waits for a context ID different from the previous one. Errors do not trigger redirects or automatic command retries. Reloading the page does not resend commands.

The supported scope is one Grafana instance and one runner, without high availability or simultaneous external changes to that runner. The consuming project owns scenarios, persisted history and dashboards. The native example and checkout integration have been validated locally; other versions and deployment arrangements have not been established by those checks.
