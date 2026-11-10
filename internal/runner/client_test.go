package runner

import (
	"context"
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
