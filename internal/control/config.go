package control

import (
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"strconv"
)

type Field struct {
	Name     string   `json:"name"`
	Label    string   `json:"label"`
	Type     string   `json:"type"`
	Required bool     `json:"required"`
	Default  string   `json:"default"`
	Min      *float64 `json:"min,omitempty"`
	Max      *float64 `json:"max,omitempty"`
}
type Scenario struct {
	ID     string            `json:"id"`
	Name   string            `json:"name"`
	Fields []Field           `json:"fields"`
	Fixed  map[string]string `json:"fixed,omitempty"`
}
type Config struct {
	RunnerURL   string     `json:"runnerUrl"`
	ContextPath string     `json:"contextPath,omitempty"`
	HistoryURL  string     `json:"historyUrl,omitempty"`
	Scenarios   []Scenario `json:"scenarios"`
}

var identifier = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_-]*$`)

func (c Config) Validate() error {
	if c.ContextPath != "" {
		u, e := url.Parse(c.ContextPath)
		if e != nil || u.IsAbs() || u.Host != "" || len(c.ContextPath) < 1 || c.ContextPath[0] != '/' || u.RawQuery != "" || u.Fragment != "" {
			return fmt.Errorf("contextPath: expected absolute path on configured runner")
		}
	}
	if len(c.Scenarios) == 0 {
		return fmt.Errorf("scenarios: expected at least one scenario")
	}
	seen := map[string]bool{}
	for _, s := range c.Scenarios {
		if !identifier.MatchString(s.ID) || seen[s.ID] || s.Name == "" {
			return fmt.Errorf("scenario id %q: expected unique identifier and nonempty name", s.ID)
		}
		seen[s.ID] = true
		names := map[string]bool{}
		for key := range s.Fixed {
			names[key] = true
			if !identifier.MatchString(key) {
				return fmt.Errorf("fixed field %q: expected identifier", key)
			}
		}
		for _, f := range s.Fields {
			if !identifier.MatchString(f.Name) || names[f.Name] || f.Label == "" {
				return fmt.Errorf("field %q: expected unique identifier and label", f.Name)
			}
			names[f.Name] = true
			if f.Type != "string" && f.Type != "number" && f.Type != "integer" && f.Type != "url" {
				return fmt.Errorf("field %q type %q: expected string, number, integer or url", f.Name, f.Type)
			}
			if f.Min != nil && f.Max != nil && *f.Min > *f.Max {
				return fmt.Errorf("field %q: min must not exceed max", f.Name)
			}
			if err := f.validate(f.Default); err != nil {
				return err
			}
		}
	}
	return nil
}

func (f Field) validate(value string) error {
	invalid := func(expected string) error { return fmt.Errorf("field %q: value does not match %s", f.Name, expected) }
	if value == "" {
		if f.Required {
			return invalid("required nonempty value")
		}
		return nil
	}
	if len(value) > 2048 {
		return invalid("maximum length 2048")
	}
	if f.Type == "url" {
		u, e := url.Parse(value)
		if e != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil {
			return invalid("HTTP(S) URL without credentials")
		}
	}
	if f.Type == "number" || f.Type == "integer" {
		n, e := strconv.ParseFloat(value, 64)
		if e != nil || math.IsNaN(n) || math.IsInf(n, 0) || (f.Type == "integer" && math.Trunc(n) != n) {
			return invalid(f.Type)
		}
		if f.Min != nil && n < *f.Min {
			return invalid(fmt.Sprintf("minimum %g", *f.Min))
		}
		if f.Max != nil && n > *f.Max {
			return invalid(fmt.Sprintf("maximum %g", *f.Max))
		}
	}
	return nil
}

func (c Config) Form(id string, values map[string]string) (url.Values, error) {
	for _, s := range c.Scenarios {
		if s.ID != id {
			continue
		}
		form := url.Values{}
		allowed := map[string]bool{}
		for k, v := range s.Fixed {
			form.Set(k, v)
		}
		for _, f := range s.Fields {
			allowed[f.Name] = true
			v, ok := values[f.Name]
			if !ok {
				v = f.Default
			}
			if err := f.validate(v); err != nil {
				return nil, err
			}
			form.Set(f.Name, v)
		}
		for k := range values {
			if !allowed[k] {
				return nil, fmt.Errorf("field %q: expected registered editable field", k)
			}
		}
		return form, nil
	}
	return nil, fmt.Errorf("scenario %q: expected registered identifier", id)
}

// UnmarshalJSON accepts Grafana provisioning's numeric environment expansion
// while keeping the browser catalog and native form defaults as strings.
func (f *Field) UnmarshalJSON(data []byte) error {
	type alias Field
	decoded := struct {
		*alias
		Default json.RawMessage `json:"default"`
	}{alias: (*alias)(f)}
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	if len(decoded.Default) == 0 || string(decoded.Default) == "null" {
		f.Default = ""
		return nil
	}
	if err := json.Unmarshal(decoded.Default, &f.Default); err == nil {
		return nil
	}
	var number json.Number
	if err := json.Unmarshal(decoded.Default, &number); err != nil {
		return fmt.Errorf("field %q default: expected string or number", f.Name)
	}
	f.Default = number.String()
	return nil
}
