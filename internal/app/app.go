package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/resource/httpadapter"
	"grafana-locust/internal/control"
	"grafana-locust/internal/runner"
)

type App struct {
	backend.CallResourceHandler
	controller *control.Controller
	config     control.Config
}

func New(_ context.Context, settings backend.AppInstanceSettings) (instancemgmt.Instance, error) {
	var config control.Config
	if err := json.Unmarshal(settings.JSONData, &config); err != nil {
		return nil, errors.New("plugin jsonData: expected runner and scenario configuration")
	}
	client, err := runner.New(config.RunnerURL)
	if err != nil {
		return nil, err
	}
	controller, err := control.New(config, client)
	if err != nil {
		return nil, err
	}
	app := &App{controller: controller, config: config}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /catalog", app.catalog)
	mux.HandleFunc("GET /state", app.state)
	mux.HandleFunc("POST /start", app.start)
	mux.HandleFunc("POST /stop", app.stop)
	app.CallResourceHandler = httpadapter.New(mux)
	return app, nil
}
func (a *App) Dispose() {}
func reply(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func (a *App) catalog(w http.ResponseWriter, r *http.Request) {
	reply(w, 200, map[string]any{"scenarios": a.config.Scenarios, "historyUrl": a.config.HistoryURL})
}
func (a *App) state(w http.ResponseWriter, r *http.Request) {
	reply(w, 200, a.controller.State(r.Context()))
}

// Grafana supplies PluginContext over its backend RPC. Never trust role headers
// or role values submitted in a browser request.
func canCommand(r *http.Request) bool {
	user := backend.PluginConfigFromContext(r.Context()).User
	return user != nil && user.Login != "" && (user.Role == "Editor" || user.Role == "Admin")
}

type command struct {
	Revision string            `json:"revision"`
	Scenario string            `json:"scenario"`
	Values   map[string]string `json:"values"`
}

func decode(w http.ResponseWriter, r *http.Request) (command, bool) {
	var cmd command
	if !canCommand(r) {
		reply(w, 403, map[string]string{"message": "Authenticated Editor or Admin required"})
		return cmd, false
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&cmd); err != nil {
		reply(w, 400, map[string]string{"message": "command: expected JSON with revision, scenario and values"})
		return cmd, false
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF || cmd.Revision == "" {
		reply(w, 400, map[string]string{"message": "revision: expected current state revision; one JSON object required"})
		return cmd, false
	}
	return cmd, true
}
func result(w http.ResponseWriter, err error) {
	if err == nil {
		reply(w, 200, map[string]bool{"success": true})
		return
	}
	status := 400
	if errors.Is(err, control.ErrConflict) {
		status = 409
	}
	reply(w, status, map[string]string{"message": err.Error()})
}
func (a *App) start(w http.ResponseWriter, r *http.Request) {
	cmd, ok := decode(w, r)
	if !ok {
		return
	}
	result(w, a.controller.Start(r.Context(), cmd.Revision, cmd.Scenario, cmd.Values))
}
func (a *App) stop(w http.ResponseWriter, r *http.Request) {
	cmd, ok := decode(w, r)
	if !ok {
		return
	}
	result(w, a.controller.Stop(r.Context(), cmd.Revision))
}
