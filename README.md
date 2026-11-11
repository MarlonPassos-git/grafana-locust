# Grafana Locust

Configure, start and stop Locust load tests from Grafana. Review saved executions, reuse their settings and open the corresponding dashboard when your runner provides execution history.

## Features

- Configure an execution and apply shared profiles before starting.
- Monitor the active execution and stop it from the executions page.
- Browse saved executions in a paginated table and reuse their settings.
- Open the dashboard for a newly confirmed execution automatically.
- Restrict start and stop commands to authenticated Grafana Editors and Admins.
- Run the included example against a local HTTP target.

Execution history and dashboard links depend on your runner's [optional integrations](docs/configuration.md#execution-context-and-history).

## Requirements

Docker and Docker Compose are enough to run the example. The plugin has been validated with Grafana 13.2.5 and Locust 2.47.0.

## Installation

Clone the source and open the standalone example:

```sh
git clone https://github.com/MarlonPassos-git/grafana-locust.git
cd grafana-locust/examples/native
```

Set the local admin password as described in the [example setup](docs/configuration.md#native-example), then build and start the services:

```sh
docker compose up -d --build
```

Open [Grafana Locust](http://localhost:3100/a/locust-control-app) and sign in as `admin` with your chosen password. The example starts idle and sends traffic only after you start an execution. Its target runs inside Docker.

## Usage

Under **More apps → Locust**, **Execuções** (Executions) shows the active execution and any configured history. **Nova execução** (New execution) opens the form, with shared profiles on the right.

Select a scenario, review its parameters and start the execution. Applying a profile or reusing saved settings fills the form for review. While the runner is busy, the form stays locked; stop the active execution from **Execuções**.

With execution context configured, a successful start opens the dashboard after the new execution ID is confirmed. Otherwise, the app returns to **Execuções** to monitor and stop the runner.

## Configuration

See the [configuration guide](docs/configuration.md) to connect your runner, define scenarios and profiles, or add execution context and history.

The current scope is one Grafana instance controlling one runner. Your project owns the Locust scenarios, stored results and dashboards. See [recovery and limitations](docs/configuration.md#recovery-and-limitations) before using the plugin with an existing runner.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, checks and architecture notes.

## Distribution status

The plugin is unsigned and is not listed in the Grafana plugin catalog. The included Docker image allows this specific plugin to load. A distribution license has not been selected.
