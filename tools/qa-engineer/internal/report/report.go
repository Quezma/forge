// Package report holds the QA run model and its on-disk JSON persistence.
package report

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

// Allowed enum values. Keep in sync with web/src/types.ts.
var (
	Severities   = []string{"critical", "high", "medium", "low"}
	Categories   = []string{"functional", "business", "ui", "security", "a11y", "performance"}
	CaseStatuses = []string{"pass", "fail", "blocked"}
)

const (
	StatusRunning    = "running"
	StatusCompleted  = "completed"
	StatusIncomplete = "incomplete"
	StatusCorrupt    = "corrupt"
)

// Case is one thing the tester tried, whatever the outcome.
type Case struct {
	ID       int       `json:"id"`
	Name     string    `json:"name"`
	Category string    `json:"category"`
	Status   string    `json:"status"`
	Notes    string    `json:"notes,omitempty"`
	At       time.Time `json:"at"`
}

// Bug is a reproducible defect with its evidence.
type Bug struct {
	ID       int       `json:"id"`
	Title    string    `json:"title"`
	Severity string    `json:"severity"`
	Category string    `json:"category"`
	Steps    []string  `json:"steps"`
	Expected string    `json:"expected"`
	Actual   string    `json:"actual"`
	Evidence []string  `json:"evidence,omitempty"`
	At       time.Time `json:"at"`
}

// Run is one QA session against one flow.
type Run struct {
	ID           string     `json:"id"`
	Name         string     `json:"name"`
	BaseURL      string     `json:"base_url"`
	AllowedHosts []string   `json:"allowed_hosts"`
	Context      string     `json:"context,omitempty"`
	Status       string     `json:"status"`
	StartedAt    time.Time  `json:"started_at"`
	EndedAt      *time.Time `json:"ended_at,omitempty"`
	Summary      string     `json:"summary,omitempty"`
	Cases        []Case     `json:"cases"`
	Bugs         []Bug      `json:"bugs"`
}

// AddCase validates c, assigns its ID and timestamp, and appends it.
func (r *Run) AddCase(c Case, now time.Time) (Case, error) {
	if strings.TrimSpace(c.Name) == "" {
		return Case{}, errors.New("case name is required")
	}
	if err := oneOf("category", c.Category, Categories); err != nil {
		return Case{}, err
	}
	if err := oneOf("status", c.Status, CaseStatuses); err != nil {
		return Case{}, err
	}
	c.ID = len(r.Cases) + 1
	c.At = now.UTC()
	r.Cases = append(r.Cases, c)
	return c, nil
}

// AddBug validates b, assigns its ID and timestamp, and appends it. dir is the
// run directory: every evidence path must be relative to it and must exist.
func (r *Run) AddBug(b Bug, dir string, now time.Time) (Bug, error) {
	switch {
	case strings.TrimSpace(b.Title) == "":
		return Bug{}, errors.New("bug title is required")
	case len(b.Steps) == 0:
		return Bug{}, errors.New("at least one reproduction step is required")
	case strings.TrimSpace(b.Expected) == "" || strings.TrimSpace(b.Actual) == "":
		return Bug{}, errors.New("expected and actual are required")
	}
	if err := oneOf("severity", b.Severity, Severities); err != nil {
		return Bug{}, err
	}
	if err := oneOf("category", b.Category, Categories); err != nil {
		return Bug{}, err
	}
	for _, p := range b.Evidence {
		if !filepath.IsLocal(p) {
			return Bug{}, fmt.Errorf("evidence %q must be a relative path inside the run directory, e.g. screenshots/1-login.png", p)
		}
		if _, err := os.Stat(filepath.Join(dir, p)); err != nil {
			return Bug{}, fmt.Errorf("evidence %q not found in the run directory", p)
		}
	}
	b.ID = len(r.Bugs) + 1
	b.At = now.UTC()
	r.Bugs = append(r.Bugs, b)
	return b, nil
}

func oneOf(field, v string, allowed []string) error {
	if slices.Contains(allowed, v) {
		return nil
	}
	return fmt.Errorf("invalid %s %q: want one of %s", field, v, strings.Join(allowed, ", "))
}

// Slug turns s into a lowercase, dash-separated, filename-safe token of at
// most 40 characters. It never returns an empty string.
func Slug(s string) string {
	var b strings.Builder
	dash := false
	for _, r := range strings.ToLower(s) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			dash = false
			continue
		}
		if !dash && b.Len() > 0 {
			b.WriteByte('-')
			dash = true
		}
	}
	out := strings.TrimSuffix(b.String(), "-")
	if len(out) > 40 {
		out = strings.TrimSuffix(out[:40], "-")
	}
	if out == "" {
		return "run"
	}
	return out
}
