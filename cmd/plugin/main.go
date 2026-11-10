package main

import (
	sdkapp "github.com/grafana/grafana-plugin-sdk-go/backend/app"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"grafana-locust/internal/app"
	"os"
)

func main() {
	if err := sdkapp.Manage("locust-control-app", app.New, sdkapp.ManageOpts{}); err != nil {
		log.DefaultLogger.Error("Plugin stopped", "error", err)
		os.Exit(1)
	}
}
