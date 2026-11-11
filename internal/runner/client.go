// Package runner adapts the native Locust web API without retrying commands.
package runner

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ErrRejected indicates a complete native response explicitly rejecting a command.
var ErrRejected = errors.New("runner rejected command")

type Client struct {
	base string
	http *http.Client
}

type Stats struct {
	State     string  `json:"state"`
	Users     int     `json:"user_count"`
	RPS       float64 `json:"current_rps"`
	FailRatio float64 `json:"fail_ratio"`
}

// New binds a client to an administrator-configured runner. Redirects are
// rejected so commands and credentials cannot escape that origin.
func New(address string) (*Client, error) {
	u, err := url.Parse(address)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("runner URL: expected absolute HTTP(S) URL without credentials, query or fragment")
	}
	return &Client{base: strings.TrimRight(address, "/"), http: &http.Client{
		Timeout:       45 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}, nil
}

func (c *Client) request(ctx context.Context, method, path string, form url.Values, target any) error {
	var body io.Reader
	if form != nil {
		body = strings.NewReader(form.Encode())
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, body)
	if err != nil {
		return errors.New("cannot construct runner request")
	}
	if form != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	response, err := c.http.Do(req)
	// Do not expose URLs, submitted fields or upstream response bodies.
	if err != nil {
		return errors.New("runner unavailable; command outcome may be unknown")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("runner returned HTTP %d", response.StatusCode)
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, 4<<20))
	if err := decoder.Decode(target); err != nil {
		return errors.New("runner returned invalid JSON")
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return errors.New("runner returned trailing or oversized JSON")
	}
	return nil
}

func (c *Client) Stats(ctx context.Context) (Stats, error) {
	var stats Stats
	if err := c.request(ctx, http.MethodGet, "/stats/requests", nil, &stats); err != nil {
		return stats, err
	}
	switch stats.State {
	case "ready", "spawning", "running", "cleanup", "stopping", "stopped", "missing":
		return stats, nil
	default:
		return stats, errors.New("runner returned invalid state")
	}
}

func (c *Client) command(ctx context.Context, path string, form url.Values) error {
	var result struct {
		Success *bool `json:"success"`
	}
	if err := c.request(ctx, http.MethodPost, path, form, &result); err != nil {
		return err
	}
	if result.Success == nil {
		return errors.New("runner returned missing command result")
	}
	if !*result.Success {
		return ErrRejected
	}
	return nil
}

// Start sends exactly one form submission. Callers must reserve the runner
// before invoking it and reconcile ambiguous failures rather than retrying.
func (c *Client) Start(ctx context.Context, form url.Values) error {
	return c.command(ctx, "/swarm", form)
}

func (c *Client) Stop(ctx context.Context) error {
	return c.command(ctx, "/stop", url.Values{})
}

// RunContext is an optional consumer-owned identity, never a local control token.
type RunContext struct {
	ID            string            `json:"id"`
	StartedAt     string            `json:"startedAt"`
	EndedAt       string            `json:"endedAt,omitempty"`
	DiagnosticURL string            `json:"diagnosticUrl"`
	Scenario      string            `json:"scenario,omitempty"`
	Values        map[string]string `json:"values,omitempty"`
}

func (c *Client) Context(ctx context.Context, path string) (RunContext, error) {
	var result RunContext
	err := c.request(ctx, http.MethodGet, path, nil, &result)
	return result, err
}

// RecentExecution contains only replayable configuration supplied by the consumer.
type RecentExecution struct {
	RunContext
	Passed *bool `json:"passed"`
}

type ExecutionPage struct {
	Executions []RecentExecution `json:"executions"`
	HasMore    bool              `json:"hasMore"`
}

func (c *Client) Recent(ctx context.Context, path string, page int) (ExecutionPage, error) {
	var result ExecutionPage
	path = fmt.Sprintf("%s?page=%d", path, page)
	if err := c.request(ctx, http.MethodGet, path, nil, &result); err != nil {
		return result, err
	}
	if result.Executions == nil {
		return result, errors.New("runner returned invalid recent executions")
	}
	return result, nil
}
