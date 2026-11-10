FROM node:24.22.1-bookworm-slim AS frontend
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json webpack.config.cjs vitest.config.ts ./
COPY src ./src
RUN npm test && npm run typecheck && npm run build && cp src/plugin.json dist/plugin.json && cp -r src/img dist/img

FROM golang:1.27.3-bookworm AS backend
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH:-amd64} go build -trimpath -o /gpx_locust_linux_${TARGETARCH:-amd64} ./cmd/plugin

FROM grafana/grafana:13.2.5
USER root
RUN mkdir -p /opt/grafana/plugins && chown -R grafana:root /opt/grafana/plugins
COPY --from=frontend --chown=grafana:root /src/dist /opt/grafana/plugins/locust-control-app
COPY --from=backend --chown=grafana:root /gpx_locust_linux_* /opt/grafana/plugins/locust-control-app/
ENV GF_PATHS_PLUGINS=/opt/grafana/plugins
ENV GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=locust-control-app
USER grafana
