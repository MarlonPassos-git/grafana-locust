package runner

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestNativeForm(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.Path != "/swarm" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		if r.Form.Get("host") != "http://target/a?x=1&y=2" {
			t.Errorf("form corrupted: %v", r.Form)
		}
		w.Write([]byte(`{"success":true}`))
	}))
	defer server.Close()
	client, err := New(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	if err := client.Start(context.Background(), url.Values{"host": {"http://target/a?x=1&y=2"}}); err != nil {
		t.Fatal(err)
	}
}

func TestCommandFailures(t *testing.T) {
	for _, body := range []string{`{"success":false,"message":"secret"}`, `{}`, `invalid secret`, `{"success":true}{}`} {
		t.Run(body, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.Write([]byte(body)) }))
			defer server.Close()
			client, _ := New(server.URL)
			err := client.Start(context.Background(), url.Values{})
			if err == nil || strings.Contains(err.Error(), "secret") {
				t.Fatalf("expected sanitized failure, got %v", err)
			}
			if calls != 1 {
				t.Fatalf("command submitted %d times", calls)
			}
		})
	}
}

func TestUnavailable(t *testing.T) {
	server := httptest.NewServer(http.NotFoundHandler())
	client, _ := New(server.URL)
	server.Close()
	if err := client.Stop(context.Background()); err == nil || strings.Contains(err.Error(), server.URL) {
		t.Fatalf("expected sanitized failure, got %v", err)
	}
}

func TestInvalidAddress(t *testing.T) {
	for _, address := range []string{"file:///tmp/test", "http://user:secret@host", "http://host?token=secret", "/relative"} {
		if _, err := New(address); err == nil || strings.Contains(err.Error(), "secret") {
			t.Fatalf("address validation failed: %v", err)
		}
	}
}

func TestRedirectRejected(t *testing.T) {
	targetCalls := 0
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { targetCalls++ }))
	defer target.Close()
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, 307) }))
	defer origin.Close()
	client, _ := New(origin.URL)
	if err := client.Stop(context.Background()); err == nil {
		t.Fatal("redirect accepted")
	}
	if targetCalls != 0 {
		t.Fatal("command escaped configured runner")
	}
}

func TestRecentExecutions(t *testing.T) {
	for _, body := range []string{`{"executions":[{"id":"run","scenario":"native","values":{"user_count":"3"},"passed":false}]}`, `{}`, `invalid secret`} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != "GET" || r.URL.Path != "/recent-executions" || r.URL.Query().Get("page") != "2" {
				t.Errorf("unexpected history request")
			}
			w.Write([]byte(body))
		}))
		client, _ := New(server.URL)
		runs, err := client.Recent(context.Background(), "/recent-executions", 2)
		server.Close()
		if strings.Contains(body, `"executions"`) {
			if err != nil || len(runs.Executions) != 1 || runs.Executions[0].Values["user_count"] != "3" || runs.Executions[0].Passed == nil || *runs.Executions[0].Passed {
				t.Fatalf("recent: %v %v", runs, err)
			}
		} else if err == nil || strings.Contains(err.Error(), "secret") {
			t.Fatalf("expected sanitized error: %v", err)
		}
	}
}

func TestHistoryPagePreservesRecordsAndContinuation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(ExecutionPage{Executions: []RecentExecution{{RunContext: RunContext{ID: "1"}}, {RunContext: RunContext{ID: "2"}}, {RunContext: RunContext{ID: "3"}}, {RunContext: RunContext{ID: "4"}}}, HasMore: true})
	}))
	defer server.Close()
	client, _ := New(server.URL)
	page, err := client.Recent(context.Background(), "/history", 0)
	if err != nil || len(page.Executions) != 4 || !page.HasMore {
		t.Fatalf("page: %+v %v", page, err)
	}
}
