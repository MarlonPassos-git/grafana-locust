# Contributing to Grafana Locust

## Setup

The frontend uses Node.js 24 LTS (`>=24.0.0 <25`) and npm, with dependencies pinned in `package-lock.json`. The backend uses Go and the Grafana Go SDK v0.298.0. The Docker build uses Node 24.22.1 and Go 1.27.3.

Run the commands below from the repository root. Docker provides both toolchains without installing them on the host. For local frontend development, use Node 24 and run `npm ci --no-audit --no-fund`.

## Frontend checks

```sh
docker run --rm --user "$(id -u):$(id -g)" \
  -e npm_config_cache=/tmp/npm -v "$PWD:/src" -w /src \
  node:24.22.1-bookworm-slim \
  sh -c 'npm ci --no-audit --no-fund && npm run lint && npm test && npm run typecheck && npm run build'
```

`npm run lint` checks formatting and static rules with Biome. `npm run format` applies formatting. The frontend Docker stage runs lint, tests, type checking and the production build.

## Backend checks

```sh
docker run --rm --user "$(id -u):$(id -g)" \
  -e GOPATH=/tmp/go-work -e GOCACHE=/tmp/go-cache -v "$PWD:/src" -w /src \
  golang:1.27.3-bookworm \
  sh -c 'gofmt -l cmd internal && go test -race ./internal/... && go vet ./internal/... && go build ./cmd/plugin'
```

`gofmt -l` lists files that need formatting; it does not fail on formatting differences. Tests use simulated local HTTP servers.

## Architecture

- `src/` contains the React interface, Grafana navigation and plugin manifest.
- `internal/app` exposes the Grafana resource handlers.
- `internal/control` validates configuration and commands, reserves the runner and reconciles execution state.
- `internal/runner` adapts the native Locust HTTP API: `GET /stats/requests`, `POST /swarm` and `POST /stop`.

The runner address is configured on the server and cannot contain URL credentials. Commands use form encoding and require `success: true`. The client rejects redirects and does not retry commands. Errors omit response bodies and submitted parameters.

Keep scenarios, stored metrics and dashboards in the consuming project. The plugin uses optional runner endpoints for execution identity and history; it also works with native Locust alone. Configuration and resource contracts are documented in [docs/configuration.md](docs/configuration.md).

## Packaging and cache

The Docker image installs the plugin in `/opt/grafana/plugins`, outside Grafana's default `/var/lib/grafana` volume. Unsigned loading is allowed only for `locust-control-app`.

The frontend build packages `plugin.json` with its base version plus a suffix derived from the SHA-256 of `module.js`. Grafana uses the version as a JavaScript cache key, so a changed bundle gets a new URL after rebuilding the image and recreating Grafana. Reload the page to load the new metadata.

The source manifest keeps the base version. Execution data never enters the hash. A successful container build alone does not prove the browser loaded the current interface; check the served version and rendered changes.

## Contributions

Keep changes focused and use Conventional Commits. Explain behavior changes and the checks you ran. Include screenshots when changing the interface. Follow the project boundaries in [AGENTS.md](AGENTS.md).
