package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

type sender struct{ response *backend.CallResourceResponse }

func (s *sender) Send(response *backend.CallResourceResponse) error {
	s.response = response
	return nil
}
func TestResourceCommandAuthorization(t *testing.T) {
	for _, role := range []string{"", "Viewer", "Editor", "Admin"} {
		for _, route := range []string{"start", "stop"} {
			t.Run(role+"/"+route, func(t *testing.T) {
				calls := 0
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.Method == "POST" {
						calls++
						w.Write([]byte(`{"success":true}`))
						return
					}
					state := "ready"
					if route == "stop" {
						state = "running"
					}
					json.NewEncoder(w).Encode(map[string]string{"state": state})
				}))
				defer server.Close()
				config := map[string]any{"runnerUrl": server.URL, "scenarios": []any{map[string]any{"id": "native", "name": "Native", "fields": []any{}}}}
				settings, _ := json.Marshal(config)
				instance, err := New(context.Background(), backend.AppInstanceSettings{JSONData: settings})
				if err != nil {
					t.Fatal(err)
				}
				app := instance.(*App)
				state := app.controller.State(context.Background())
				body, _ := json.Marshal(map[string]any{"revision": state.Revision, "scenario": "native"})
				var user *backend.User
				if role != "" {
					user = &backend.User{Login: "tester", Role: role}
				}
				response := &sender{}
				err = app.CallResource(context.Background(), &backend.CallResourceRequest{
					PluginContext: backend.PluginContext{User: user},
					Path:          route, URL: "http://grafana/" + route, Method: "POST", Body: body,
					Headers: map[string][]string{"X-Grafana-Role": {"Admin"}},
				}, response)
				if err != nil {
					t.Fatal(err)
				}
				permitted := role == "Editor" || role == "Admin"
				expected := 403
				if permitted {
					expected = 200
				}
				if response.response == nil || response.response.Status != expected {
					t.Fatalf("response: %+v", response.response)
				}
				count := 0
				if permitted {
					count = 1
				}
				if calls != count {
					t.Fatalf("upstream commands=%d; expected %d", calls, count)
				}
			})
		}
	}
}
