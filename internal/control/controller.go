// Package control owns one runner and serializes its lifecycle independently of browser tabs.
package control

import (
	"context"
	"crypto/rand"
	"errors"
	"net/url"
	"sync"

	"grafana-locust/internal/runner"
)

type Runner interface {
	Stats(context.Context) (runner.Stats, error)
	Start(context.Context, url.Values) error
	Stop(context.Context) error
}
type State struct {
	Phase    string             `json:"phase"`
	Revision string             `json:"revision"`
	Scenario string             `json:"scenario,omitempty"`
	Stats    runner.Stats       `json:"stats"`
	Context  *runner.RunContext `json:"context,omitempty"`
	Values   map[string]string  `json:"values,omitempty"`
	Message  string             `json:"message,omitempty"`
}
type Controller struct {
	mu               sync.Mutex
	runner           Runner
	config           Config
	state            State
	busy             bool
	observedActive   bool
	seenRunnerActive bool
	ambiguous        bool
	previousContext  string
}

func revision() string { return rand.Text() }
func New(config Config, r Runner) (*Controller, error) {
	if err := config.Validate(); err != nil {
		return nil, err
	}
	return &Controller{runner: r, config: config, state: State{Phase: "unavailable", Revision: revision()}}, nil
}
func active(state string) bool {
	return state == "running" || state == "spawning" || state == "cleanup" || state == "stopping"
}
func (c *Controller) reconcile(ctx context.Context) error {
	stats, err := c.runner.Stats(ctx)
	if err != nil {
		c.state.Message = err.Error()
		return err
	}
	if reader, ok := c.runner.(interface {
		Context(context.Context, string) (runner.RunContext, error)
	}); ok && c.config.ContextPath != "" {
		run, contextErr := reader.Context(ctx, c.config.ContextPath)
		// A restarted runner has no batch context and reports its initial ready state.
		// The previous process can no longer complete our cached persistence barrier.
		if contextErr == nil && run.ID == "" && stats.State == "ready" && c.observedActive {
			c.state = State{Phase: "ready", Revision: revision(), Stats: stats}
			c.observedActive = false
			c.seenRunnerActive = false
			c.ambiguous = false
			c.previousContext = ""
			return nil
		}
		if contextErr == nil && run.ID != "" && run.ID != c.previousContext {
			if c.state.Context != nil && c.state.Context.ID != run.ID {
				c.state.Revision = revision()
			}
			c.state.Context = &run
			if run.Scenario != "" {
				c.state.Scenario = run.Scenario
			}
			if run.Values != nil {
				c.state.Values = run.Values
			}
			c.observedActive = true
		}
	}
	c.state.Stats = stats
	c.state.Message = ""
	if active(stats.State) {
		c.seenRunnerActive = true
		if !c.observedActive && c.state.Phase != "starting" && c.state.Phase != "stopping" && !c.ambiguous {
			c.state.Revision = revision()
			if c.state.Context == nil {
				c.state.Scenario = ""
				c.state.Values = nil
			}
		}
		c.observedActive = true
		if stats.State == "cleanup" || stats.State == "stopping" || c.state.Phase == "stopping" {
			c.state.Phase = "stopping"
		} else {
			c.state.Phase = "running"
		}
		return nil
	}
	// Native stopped can precede consumer persistence/report finalization.
	// A configured context is the completion barrier for the consumer's batch.
	if c.config.ContextPath != "" && c.observedActive && (c.state.Context == nil || c.state.Context.EndedAt == "") {
		if c.seenRunnerActive || c.state.Phase == "stopping" {
			c.state.Phase = "stopping"
		} else {
			c.state.Phase = "starting"
		}
		c.state.Message = "Waiting for the consumer to finish persisting this execution."
		return nil
	}
	// Locust returns from /swarm before its spawn greenlet changes state.
	// Keep the reservation while the accepted start is still pending.
	if c.state.Phase == "starting" && !c.observedActive {
		return nil
	}
	if c.ambiguous && !c.observedActive {
		c.state.Phase = "error"
		c.state.Message = "Command outcome unknown; runner is reserved until its execution is observed."
		return nil
	}
	if c.observedActive || c.state.Phase == "finished" {
		c.state.Phase = "finished"
	} else {
		c.state.Phase = "ready"
	}
	c.ambiguous = false
	c.observedActive = false
	c.seenRunnerActive = false
	return nil
}
func (c *Controller) State(ctx context.Context) State {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.busy {
		if err := c.reconcile(ctx); err != nil {
			c.state.Phase = "unavailable"
		}
	}
	return c.state
}

var ErrConflict = errors.New("runner state changed or an operation is already in progress; refresh before submitting")

// Start reserves before I/O. A stale browser revision never changes an active run.
func (c *Controller) Start(ctx context.Context, expected, scenario string, values map[string]string) error {
	form, err := c.config.Form(scenario, values)
	if err != nil {
		return err
	}
	c.mu.Lock()
	if c.busy || expected != c.state.Revision {
		c.mu.Unlock()
		return ErrConflict
	}
	if err = c.reconcile(ctx); err != nil {
		c.mu.Unlock()
		return err
	}
	if expected != c.state.Revision || c.ambiguous || (c.state.Phase != "ready" && c.state.Phase != "finished") {
		c.mu.Unlock()
		return ErrConflict
	}
	c.busy = true
	c.observedActive = false
	c.seenRunnerActive = false
	if c.state.Context != nil {
		c.previousContext = c.state.Context.ID
	}
	submitted := map[string]string{}
	for key := range values {
		submitted[key] = form.Get(key)
	}
	for _, s := range c.config.Scenarios {
		if s.ID == scenario {
			for _, field := range s.Fields {
				submitted[field.Name] = form.Get(field.Name)
			}
		}
	}
	c.state = State{Phase: "starting", Revision: revision(), Scenario: scenario, Values: submitted}
	c.mu.Unlock()
	err = c.runner.Start(ctx, form)
	c.mu.Lock()
	defer c.mu.Unlock()
	c.busy = false
	// Even a failed response can follow a partial start. Never resend automatically.
	if err != nil {
		c.ambiguous = !errors.Is(err, runner.ErrRejected)
		c.state.Phase = "error"
		c.state.Message = err.Error()
	}
	return err
}
func (c *Controller) Stop(ctx context.Context, expected string) error {
	c.mu.Lock()
	if c.busy || expected != c.state.Revision {
		c.mu.Unlock()
		return ErrConflict
	}
	if err := c.reconcile(ctx); err != nil {
		c.mu.Unlock()
		return err
	}
	if expected != c.state.Revision || c.state.Phase != "running" {
		c.mu.Unlock()
		return ErrConflict
	}
	c.busy = true
	c.state.Phase = "stopping"
	c.mu.Unlock()
	err := c.runner.Stop(ctx)
	c.mu.Lock()
	defer c.mu.Unlock()
	c.busy = false
	if err != nil {
		c.ambiguous = true
		c.state.Message = err.Error()
	}
	return err
}
