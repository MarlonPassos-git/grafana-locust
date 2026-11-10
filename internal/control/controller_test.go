package control

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"sync"
	"testing"

	"grafana-locust/internal/runner"
)

type fakeRunner struct {
	mu      sync.Mutex
	state   string
	starts  int
	stops   int
	entered chan struct{}
	release chan struct{}
	failure error
}

func (f *fakeRunner) Stats(context.Context) (runner.Stats, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return runner.Stats{State: f.state}, nil
}
func (f *fakeRunner) Start(context.Context, url.Values) error {
	f.mu.Lock()
	f.starts++
	f.mu.Unlock()
	if f.entered != nil {
		close(f.entered)
		<-f.release
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.failure != nil {
		return f.failure
	}
	f.state = "running"
	return nil
}
func (f *fakeRunner) Stop(context.Context) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.stops++
	f.state = "stopping"
	return nil
}
func (f *fakeRunner) set(state string) { f.mu.Lock(); defer f.mu.Unlock(); f.state = state }
func configuration() Config {
	return Config{Scenarios: []Scenario{{ID: "native", Name: "Native", Fields: []Field{{Name: "user_count", Label: "Users", Type: "integer", Required: true, Default: "1"}}}}}
}
func TestConcurrentStartAndStaleStop(t *testing.T) {
	ctx := context.Background()
	f := &fakeRunner{state: "ready", entered: make(chan struct{}), release: make(chan struct{})}
	c, err := New(configuration(), f)
	if err != nil {
		t.Fatal(err)
	}
	initial := c.State(ctx)
	done := make(chan error, 1)
	go func() { done <- c.Start(ctx, initial.Revision, "native", nil) }()
	<-f.entered
	if got := c.State(ctx).Phase; got != "starting" {
		t.Fatalf("phase %s", got)
	}
	if err := c.Start(ctx, initial.Revision, "native", nil); !errors.Is(err, ErrConflict) {
		t.Fatalf("second start: %v", err)
	}
	close(f.release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	running := c.State(ctx)
	if err := c.Stop(ctx, initial.Revision); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale stop: %v", err)
	}
	if err := c.Stop(ctx, running.Revision); err != nil {
		t.Fatal(err)
	}
	if err := c.Start(ctx, running.Revision, "native", nil); !errors.Is(err, ErrConflict) {
		t.Fatalf("start during stop: %v", err)
	}
	f.set("stopped")
	finished := c.State(ctx)
	if finished.Phase != "finished" {
		t.Fatalf("phase %s", finished.Phase)
	}
	// Disable the test barrier before the next operation.
	f.entered = nil
	if err := c.Start(ctx, finished.Revision, "native", map[string]string{"user_count": "2"}); err != nil {
		t.Fatal(err)
	}
	if err := c.Stop(ctx, running.Revision); !errors.Is(err, ErrConflict) {
		t.Fatalf("old run stop: %v", err)
	}
	if f.starts != 2 || f.stops != 1 {
		t.Fatalf("starts=%d stops=%d", f.starts, f.stops)
	}
}
func TestRecoveryWithActiveRunner(t *testing.T) {
	ctx := context.Background()
	f := &fakeRunner{state: "running"}
	c, _ := New(configuration(), f)
	state := c.State(ctx)
	if state.Phase != "running" {
		t.Fatal(state)
	}
	if err := c.Start(ctx, state.Revision, "native", nil); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	if err := c.Stop(ctx, state.Revision); err != nil {
		t.Fatal(err)
	}
}
func TestAmbiguousCommandDoesNotRetryOrRelease(t *testing.T) {
	ctx := context.Background()
	f := &fakeRunner{state: "ready", failure: errors.New("timeout")}
	c, _ := New(configuration(), f)
	state := c.State(ctx)
	if err := c.Start(ctx, state.Revision, "native", nil); err == nil {
		t.Fatal("missing timeout")
	}
	unknown := c.State(ctx)
	if unknown.Phase != "error" {
		t.Fatal(unknown)
	}
	if err := c.Start(ctx, unknown.Revision, "native", nil); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	if f.starts != 1 {
		t.Fatal("retried command")
	}
	f.set("running")
	c.State(ctx)
	f.set("stopped")
	if got := c.State(ctx).Phase; got != "finished" {
		t.Fatal(got)
	}
}
func TestFormValidation(t *testing.T) {
	config := configuration()
	for _, values := range []map[string]string{{"user_count": "NaN"}, {"user_count": "1.5"}, {"user_count": ""}, {"runnerUrl": "http://other"}} {
		if _, err := config.Form("native", values); err == nil {
			t.Fatalf("accepted %v", values)
		}
	}
	if _, err := config.Form("missing", nil); err == nil {
		t.Fatal("unknown scenario accepted")
	}
	form, err := config.Form("native", nil)
	if err != nil || form.Get("user_count") != "1" {
		t.Fatalf("default: %v %v", form, err)
	}
}

func TestRejectedStartCanBeCorrected(t *testing.T) {
	ctx := context.Background()
	f := &fakeRunner{state: "ready", failure: runner.ErrRejected}
	c, _ := New(configuration(), f)
	state := c.State(ctx)
	if err := c.Start(ctx, state.Revision, "native", nil); !errors.Is(err, runner.ErrRejected) {
		t.Fatal(err)
	}
	f.failure = nil
	corrected := c.State(ctx)
	if err := c.Start(ctx, corrected.Revision, "native", nil); err != nil {
		t.Fatal(err)
	}
}

type delayedRunner struct{ fakeRunner }

func (f *delayedRunner) Start(context.Context, url.Values) error { f.starts++; return nil }
func TestAcceptedStartReservesWhileNativeRunnerStillReady(t *testing.T) {
	ctx := context.Background()
	f := &delayedRunner{fakeRunner: fakeRunner{state: "ready"}}
	c, _ := New(configuration(), f)
	state := c.State(ctx)
	if err := c.Start(ctx, state.Revision, "native", nil); err != nil {
		t.Fatal(err)
	}
	pending := c.State(ctx)
	if pending.Phase != "starting" {
		t.Fatalf("reservation lost: %+v", pending)
	}
	if err := c.Start(ctx, pending.Revision, "native", nil); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	if f.starts != 1 {
		t.Fatal("duplicate start")
	}
	f.set("running")
	running := c.State(ctx)
	if running.Revision != pending.Revision || running.Scenario != "native" {
		t.Fatal("lost accepted start identity")
	}
}

type contextRunner struct {
	fakeRunner
	run runner.RunContext
}

func (f *contextRunner) Context(context.Context, string) (runner.RunContext, error) {
	return f.run, nil
}
func TestContextWaitsForNewPersistedIdentity(t *testing.T) {
	ctx := context.Background()
	config := configuration()
	config.ContextPath = "/execution-context"
	f := &contextRunner{fakeRunner: fakeRunner{state: "stopped"}, run: runner.RunContext{ID: "previous", EndedAt: "then", DiagnosticURL: "http://grafana/previous"}}
	c, _ := New(config, f)
	before := c.State(ctx)
	if err := c.Start(ctx, before.Revision, "native", nil); err != nil {
		t.Fatal(err)
	}
	pending := c.State(ctx)
	if pending.Context != nil {
		t.Fatal("previous report leaked into new run")
	}
	f.run = runner.RunContext{ID: "new", Scenario: "native", DiagnosticURL: "http://grafana/new"}
	current := c.State(ctx)
	if current.Context == nil || current.Context.ID != "new" {
		t.Fatal("new persisted context missing")
	}
	// A backend restarted during an active test recovers the consumer identity.
	recovered, _ := New(config, f)
	if state := recovered.State(ctx); state.Context == nil || state.Context.ID != "new" || state.Phase != "running" || state.Scenario != "native" {
		t.Fatal(state)
	}
}

func TestGrafanaNumericProvisioningDefaults(t *testing.T) {
	var config Config
	err := json.Unmarshal([]byte(`{"scenarios":[{"id":"checkout","name":"Checkout","fields":[{"name":"total","label":"Total","type":"integer","default":50},{"name":"duration","label":"Duration","type":"number","default":null}]}]}`), &config)
	if err != nil {
		t.Fatal(err)
	}
	form, err := config.Form("checkout", nil)
	if err != nil || form.Get("total") != "50" || form.Get("duration") != "" {
		t.Fatalf("%v %v", form, err)
	}
}

func TestConsumerFinalizationBlocksNewStart(t *testing.T) {
	ctx := context.Background()
	config := configuration()
	config.ContextPath = "/execution-context"
	f := &contextRunner{fakeRunner: fakeRunner{state: "running"}, run: runner.RunContext{ID: "run", Scenario: "native"}}
	c, _ := New(config, f)
	c.State(ctx)
	f.set("stopped")
	finalizing := c.State(ctx)
	if finalizing.Phase != "stopping" {
		t.Fatal(finalizing)
	}
	if err := c.Start(ctx, finalizing.Revision, "native", nil); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	f.run.EndedAt = "finished"
	if state := c.State(ctx); state.Phase != "finished" {
		t.Fatal(state)
	}
}

func TestRecoveryReservesActiveContextDespiteCachedIdleStats(t *testing.T) {
	ctx := context.Background()
	config := configuration()
	config.ContextPath = "/execution-context"
	f := &contextRunner{fakeRunner: fakeRunner{state: "stopped"}, run: runner.RunContext{ID: "active", Scenario: "native"}}
	c, _ := New(config, f)
	recovered := c.State(ctx)
	if recovered.Phase != "starting" {
		t.Fatal(recovered)
	}
	if err := c.Start(ctx, recovered.Revision, "native", nil); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	f.set("running")
	if state := c.State(ctx); state.Phase != "running" {
		t.Fatal(state)
	}
}
