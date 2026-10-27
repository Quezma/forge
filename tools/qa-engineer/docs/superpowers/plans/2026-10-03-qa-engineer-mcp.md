# QA Engineer MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single Go binary, `qa-engineer`, that exposes browser-driving QA tools to Claude over MCP, records every test case and bug as JSON + screenshots, and serves a React dashboard to browse the results.

**Architecture:** Claude is the QA brain; the binary only provides tools. `internal/browser` wraps playwright-go behind an allowlist forward proxy; `internal/report` persists runs atomically to `qa-reports/<run-id>/run.json`; `internal/mcp` adapts everything into 19 MCP tools (the calling agent decides what to test); `internal/web` serves a read-only JSON API plus the embedded Vite/React SPA.

**Tech Stack:** Go 1.26, `github.com/mxschmitt/playwright-go` v0.6201.1, `github.com/modelcontextprotocol/go-sdk` v1.8.0, axe-core 4.13.0 (embedded), React 19 + Vite 8 + TypeScript, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-03-qa-engineer-mcp-design.md`

## Global Constraints

- Module path: `qa-engineer`.
- playwright-go import path is `github.com/mxschmitt/playwright-go` (NOT `playwright-community`; that path fails to resolve for v0.6100+). Import name `playwright`.
- MCP SDK import: `sdk "github.com/modelcontextprotocol/go-sdk/mcp"` (aliased; our package is also named `mcp`).
- Nothing may write to stdout in `qa-engineer mcp` except the MCP transport. Playwright driver output goes to stderr.
- `allowed_hosts` is required and non-empty; entries are `host` (any port), `host:port` (that port only) or `*.domain` (subdomains, not apex). Case-insensitive.
- Report enums: severities `critical, high, medium, low`; categories `functional, business, ui, security, a11y, performance`; case statuses `pass, fail, blocked`; run statuses `running, completed, incomplete, corrupt`.
- A `running` run whose `run.json` is older than 30 minutes reads as `incomplete`.
- Viewport presets: mobile 390x844, tablet 820x1180, desktop 1440x900. Default action timeout 10000 ms.
- Dashboard binds `127.0.0.1`, default port 7777. Fixture default port 3999.
- The tool ships no checklists, strategies or test inputs; the calling agent supplies them.
- Every slice or map in an MCP tool output must be non-nil (outputs are validated against inferred JSON schemas; `null` is not an array).
- Strict TDD: write the test, watch it fail for the stated reason, then implement.
- Commits: Conventional Commits. Per the user's global instructions, **no `Co-Authored-By` trailer or AI attribution**.
- Files stay under 500 lines.
- Browser-backed tests `t.Skip` when Chromium is missing. When verifying, run with `-v` and confirm they report PASS, not SKIP (Chromium is installed on this machine).

## Review Focus

1. **Stale element refs.** Claude clicks a ref from a snapshot taken before navigation. Expected: an error within the given timeout telling it to call `snapshot` again. Pinned in Task 5 (`TestStaleRefGivesActionableError`).
2. **Huge pages.** A 500 KB snapshot would flood Claude's context. Expected: truncated with an explanatory note. Pinned in Task 5 (`TestTruncateSnapshot`).
3. **Claude Code closes mid-run.** Expected: browser closed, run saved as `incomplete`, findings kept. Pinned in Task 8 (`TestShutdownMarksRunIncomplete`).
4. **Long sessions.** Console and network logs grow without bound. Expected: the newest 1000 entries are kept. Pinned in Task 5 (`TestLogsAreCapped`).
5. **Same flow started twice in one second.** Expected: distinct run directories, no overwrite. Pinned in Task 1 (`TestCreateAvoidsIDCollision`).

## File Map

```
go.mod / go.sum
Makefile                            build web + binary, run all tests
.gitignore
cmd/qa-engineer/main.go             subcommands: mcp, serve, install, fixture
cmd/qa-engineer/main_test.go        stdio MCP smoke test, usage test
internal/report/report.go           Run/Case/Bug model, validation, Slug
internal/report/store.go            Store: Create/Save/Load/List, atomic writes, derived status
internal/report/report_test.go
internal/browser/guard.go           allowlist matching
internal/browser/proxy.go           allowlist forward proxy (HTTP + CONNECT)
internal/browser/guard_test.go
internal/browser/proxy_test.go
internal/browser/session.go         Launch/Close, navigate, snapshot, actions, logs, screenshot
internal/browser/session_test.go
internal/browser/extras.go          viewport, new context, storage, intercept, a11y
internal/browser/extras_test.go
internal/browser/axe.min.js         axe-core 4.13.0 (vendored, embedded)
internal/fixtureapp/app.go          deliberately buggy login app
internal/fixtureapp/app_test.go
internal/mcp/server.go              Server, lifecycle tools, tool helpers
internal/mcp/instructions.go        QA-engineer instructions sent to the client
internal/mcp/tools_browser.go       browser tools
internal/mcp/tools_report.go        reporting tools
internal/mcp/server_test.go         unit tests (no browser)
internal/mcp/e2e_test.go            end-to-end session against the fixture app
internal/web/handler.go             JSON API + SPA handler
internal/web/embed.go               go:embed of dist
internal/web/dist/.gitkeep
internal/web/handler_test.go
web/                                Vite + React dashboard (Task 11)
```

---

### Task 1: Project skeleton and report store

**Files:**
- Create: `go.mod`, `.gitignore`, `internal/report/report.go`, `internal/report/store.go`
- Test: `internal/report/report_test.go`

**Interfaces:**
- Produces:
  - `report.Severities, report.Categories, report.CaseStatuses []string`
  - consts `report.StatusRunning|StatusCompleted|StatusIncomplete|StatusCorrupt`
  - `type Case{ID int; Name, Category, Status, Notes string; At time.Time}`
  - `type Bug{ID int; Title, Severity, Category string; Steps []string; Expected, Actual string; Evidence []string; At time.Time}`
  - `type Run{ID, Name, BaseURL string; AllowedHosts []string; Context, Status string; StartedAt time.Time; EndedAt *time.Time; Summary string; Cases []Case; Bugs []Bug}`
  - `(*Run).AddCase(c Case, now time.Time) (Case, error)`
  - `(*Run).AddBug(b Bug, dir string, now time.Time) (Bug, error)`
  - `report.Slug(s string) string`, `report.ValidID(id string) bool`, `report.ErrCorrupt`
  - `type Store struct{ Dir string }` with `RunDir(id) string`, `Create(name, baseURL string, hosts []string, context string, now time.Time) (*Run, error)`, `Save(*Run) error`, `Load(id string) (*Run, error)`, `List() ([]Summary, error)`
  - `type Summary{ID, Name, BaseURL, Status string; StartedAt time.Time; EndedAt *time.Time; Counts Counts}`; `type Counts{Cases, Bugs map[string]int}`

- [ ] **Step 1: Initialise the module and ignore file**

```bash
cd path/to/tester
go mod init qa-engineer
mkdir -p internal/report
```

Create `.gitignore`:

```
/bin/
/qa-reports/
/web/node_modules/
/internal/web/dist/*
!/internal/web/dist/.gitkeep
```

- [ ] **Step 2: Write the failing tests**

Create `internal/report/report_test.go`:

```go
package report

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

var t0 = time.Date(2026, 10, 3, 10, 15, 0, 0, time.UTC)

func newStore(t *testing.T) Store {
	return Store{Dir: filepath.Join(t.TempDir(), "qa-reports")}
}

func mustCreate(t *testing.T, s Store, name string, at time.Time) *Run {
	t.Helper()
	r, err := s.Create(name, "http://localhost:3000", []string{"localhost:3000"}, "user a@b.com", at)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestCreateWritesRunAndReloads(t *testing.T) {
	s := newStore(t)
	r := mustCreate(t, s, "Login Flow", t0)
	if r.ID != "20261003T101500Z-login-flow" {
		t.Fatalf("id = %q", r.ID)
	}
	if fi, err := os.Stat(filepath.Join(s.RunDir(r.ID), "screenshots")); err != nil || !fi.IsDir() {
		t.Fatalf("screenshots dir missing: %v", err)
	}
	got, err := s.Load(r.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != StatusRunning || got.BaseURL != "http://localhost:3000" || got.Context != "user a@b.com" || got.Cases == nil || got.Bugs == nil {
		t.Fatalf("reloaded run = %+v", got)
	}
}

func TestCreateAvoidsIDCollision(t *testing.T) {
	s := newStore(t)
	a := mustCreate(t, s, "login", t0)
	b := mustCreate(t, s, "login", t0)
	if b.ID != a.ID+"-2" {
		t.Fatalf("second id = %q, want %q", b.ID, a.ID+"-2")
	}
}

func TestSaveIsAtomicAndLeavesNoTempFiles(t *testing.T) {
	s := newStore(t)
	r := mustCreate(t, s, "login", t0)
	if _, err := r.AddCase(Case{Name: "valid login", Category: "functional", Status: "pass"}, t0); err != nil {
		t.Fatal(err)
	}
	if err := s.Save(r); err != nil {
		t.Fatal(err)
	}
	entries, _ := os.ReadDir(s.RunDir(r.ID))
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".tmp") {
			t.Fatalf("temp file left behind: %s", e.Name())
		}
	}
	got, _ := s.Load(r.ID)
	if len(got.Cases) != 1 || got.Cases[0].ID != 1 || !got.Cases[0].At.Equal(t0) {
		t.Fatalf("cases = %+v", got.Cases)
	}
}

func TestAddCaseValidates(t *testing.T) {
	r := &Run{}
	for _, c := range []Case{
		{Name: "", Category: "functional", Status: "pass"},
		{Name: "x", Category: "nope", Status: "pass"},
		{Name: "x", Category: "functional", Status: "maybe"},
	} {
		if _, err := r.AddCase(c, t0); err == nil {
			t.Errorf("AddCase(%+v) succeeded, want error", c)
		}
	}
	if len(r.Cases) != 0 {
		t.Fatalf("invalid cases were appended: %+v", r.Cases)
	}
}

func TestAddBugValidatesFieldsAndEvidence(t *testing.T) {
	s := newStore(t)
	r := mustCreate(t, s, "login", t0)
	dir := s.RunDir(r.ID)
	if err := os.WriteFile(filepath.Join(dir, "screenshots", "1-err.png"), []byte("png"), 0o644); err != nil {
		t.Fatal(err)
	}
	valid := Bug{Title: "Uppercase email rejected", Severity: "medium", Category: "functional",
		Steps: []string{"log in as QA@EXAMPLE.COM"}, Expected: "login succeeds", Actual: "says no account exists"}

	broken := map[string]func(b *Bug){
		"no title":     func(b *Bug) { b.Title = " " },
		"bad severity": func(b *Bug) { b.Severity = "urgent" },
		"bad category": func(b *Bug) { b.Category = "vibes" },
		"no steps":     func(b *Bug) { b.Steps = nil },
		"no actual":    func(b *Bug) { b.Actual = "" },
		"parent dir":   func(b *Bug) { b.Evidence = []string{"../outside.png"} },
		"absolute":     func(b *Bug) { b.Evidence = []string{"/tmp/x.png"} },
		"missing file": func(b *Bug) { b.Evidence = []string{"screenshots/nope.png"} },
	}
	for name, mutate := range broken {
		t.Run(name, func(t *testing.T) {
			b := valid
			b.Steps = slices.Clone(valid.Steps)
			mutate(&b)
			if _, err := r.AddBug(b, dir, t0); err == nil {
				t.Fatal("AddBug succeeded, want error")
			}
		})
	}

	good := valid
	good.Evidence = []string{"screenshots/1-err.png"}
	got, err := r.AddBug(good, dir, t0)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != 1 || len(r.Bugs) != 1 {
		t.Fatalf("bug = %+v, bugs = %d", got, len(r.Bugs))
	}
}

func TestLoadDerivesIncompleteForStaleRunningRun(t *testing.T) {
	s := newStore(t)
	r := mustCreate(t, s, "login", t0)
	old := time.Now().Add(-31 * time.Minute)
	if err := os.Chtimes(filepath.Join(s.RunDir(r.ID), "run.json"), old, old); err != nil {
		t.Fatal(err)
	}
	got, err := s.Load(r.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != StatusIncomplete {
		t.Fatalf("status = %q, want %q", got.Status, StatusIncomplete)
	}
}

func TestLoadRejectsInvalidIDs(t *testing.T) {
	s := newStore(t)
	for _, id := range []string{"", ".", "..", "../x", "a/b", ".hidden", "bad id"} {
		if _, err := s.Load(id); err == nil {
			t.Errorf("Load(%q) succeeded, want error", id)
		}
	}
}

func TestListNewestFirstWithCountsAndCorruptRuns(t *testing.T) {
	s := newStore(t)
	older := mustCreate(t, s, "signup", t0)
	newer := mustCreate(t, s, "login", t0.Add(time.Hour))
	newer.AddCase(Case{Name: "a", Category: "functional", Status: "pass"}, t0)
	newer.AddCase(Case{Name: "b", Category: "ui", Status: "fail"}, t0)
	if _, err := newer.AddBug(Bug{Title: "t", Severity: "high", Category: "ui", Steps: []string{"s"}, Expected: "e", Actual: "a"}, s.RunDir(newer.ID), t0); err != nil {
		t.Fatal(err)
	}
	if err := s.Save(newer); err != nil {
		t.Fatal(err)
	}
	broken := filepath.Join(s.Dir, "20250101T000000Z-broken")
	os.MkdirAll(broken, 0o755)
	os.WriteFile(filepath.Join(broken, "run.json"), []byte("{not json"), 0o644)
	os.MkdirAll(filepath.Join(s.Dir, "empty-dir"), 0o755) // no run.json: skipped

	list, err := s.List()
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, r := range list {
		ids = append(ids, r.ID)
	}
	want := []string{newer.ID, older.ID, "20250101T000000Z-broken"}
	if !slices.Equal(ids, want) {
		t.Fatalf("ids = %v, want %v", ids, want)
	}
	c := list[0].Counts
	if c.Cases["pass"] != 1 || c.Cases["fail"] != 1 || c.Cases["blocked"] != 0 || c.Bugs["high"] != 1 || c.Bugs["low"] != 0 {
		t.Fatalf("counts = %+v", c)
	}
	if list[2].Status != StatusCorrupt || list[2].Counts.Bugs == nil {
		t.Fatalf("corrupt entry = %+v", list[2])
	}
}

func TestListMissingDirIsEmpty(t *testing.T) {
	list, err := newStore(t).List()
	if err != nil || list == nil || len(list) != 0 {
		t.Fatalf("list = %v, err = %v", list, err)
	}
}

func TestSlug(t *testing.T) {
	tests := map[string]string{
		"Login Flow":            "login-flow",
		"  ¡Checkout!  v2 ":     "checkout-v2",
		"":                      "run",
		"!!!":                   "run",
		strings.Repeat("a", 60): strings.Repeat("a", 40),
	}
	for in, want := range tests {
		if got := Slug(in); got != want {
			t.Errorf("Slug(%q) = %q, want %q", in, got, want)
		}
	}
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `go test ./internal/report/`
Expected: FAIL to compile (`undefined: Store`, `undefined: Run`, ...).

- [ ] **Step 4: Implement the model**

Create `internal/report/report.go`:

```go
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
```

- [ ] **Step 5: Implement the store**

Create `internal/report/store.go`:

```go
package report

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// A run still marked running whose file has not changed for this long is
// reported as incomplete: its MCP process most likely died.
const staleAfter = 30 * time.Minute

// ErrCorrupt wraps run.json files that exist but do not parse.
var ErrCorrupt = errors.New("corrupt run.json")

var idPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)

// ValidID reports whether id is safe to use as a run directory name.
func ValidID(id string) bool { return idPattern.MatchString(id) }

// Store reads and writes runs under Dir, one directory per run.
type Store struct{ Dir string }

// RunDir returns the directory of run id.
func (s Store) RunDir(id string) string { return filepath.Join(s.Dir, id) }

// Create makes a new run directory (with screenshots/) and writes run.json.
func (s Store) Create(name, baseURL string, hosts []string, context string, now time.Time) (*Run, error) {
	if strings.TrimSpace(name) == "" {
		return nil, errors.New("run name is required")
	}
	if err := os.MkdirAll(s.Dir, 0o755); err != nil {
		return nil, err
	}
	base := now.UTC().Format("20060102T150405Z") + "-" + Slug(name)
	id := base
	for i := 2; ; i++ {
		err := os.Mkdir(s.RunDir(id), 0o755)
		if err == nil {
			break
		}
		if !errors.Is(err, fs.ErrExist) {
			return nil, err
		}
		id = fmt.Sprintf("%s-%d", base, i)
	}
	if err := os.Mkdir(filepath.Join(s.RunDir(id), "screenshots"), 0o755); err != nil {
		return nil, err
	}
	r := &Run{
		ID: id, Name: name, BaseURL: baseURL, AllowedHosts: hosts, Context: context,
		Status: StatusRunning, StartedAt: now.UTC(), Cases: []Case{}, Bugs: []Bug{},
	}
	return r, s.Save(r)
}

// Save writes run.json atomically: temp file in the same directory, then rename.
func (s Store) Save(r *Run) error {
	data, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return err
	}
	dir := s.RunDir(r.ID)
	tmp, err := os.CreateTemp(dir, "run-*.json.tmp")
	if err != nil {
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmp.Name())
		return err
	}
	return os.Rename(tmp.Name(), filepath.Join(dir, "run.json"))
}

// Load reads run id, deriving StatusIncomplete for stale running runs.
func (s Store) Load(id string) (*Run, error) {
	if !ValidID(id) {
		return nil, fmt.Errorf("invalid run id %q", id)
	}
	path := filepath.Join(s.RunDir(id), "run.json")
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("run %s: %w", id, err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("run %s: %w", id, err)
	}
	var r Run
	if err := json.Unmarshal(data, &r); err != nil {
		return nil, fmt.Errorf("run %s: %w: %v", id, ErrCorrupt, err)
	}
	if r.Status == StatusRunning && time.Since(info.ModTime()) > staleAfter {
		r.Status = StatusIncomplete
	}
	return &r, nil
}

// Counts holds per-status case counts and per-severity bug counts.
type Counts struct {
	Cases map[string]int `json:"cases"`
	Bugs  map[string]int `json:"bugs"`
}

// Summary is the list view of a run.
type Summary struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	BaseURL   string     `json:"base_url"`
	Status    string     `json:"status"`
	StartedAt time.Time  `json:"started_at"`
	EndedAt   *time.Time `json:"ended_at,omitempty"`
	Counts    Counts     `json:"counts"`
}

// List returns all runs, newest first. Corrupt runs are listed with
// StatusCorrupt; directories without run.json are skipped.
func (s Store) List() ([]Summary, error) {
	out := []Summary{}
	entries, err := os.ReadDir(s.Dir)
	if errors.Is(err, fs.ErrNotExist) {
		return out, nil
	}
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		if !e.IsDir() || !ValidID(e.Name()) {
			continue
		}
		r, err := s.Load(e.Name())
		switch {
		case errors.Is(err, ErrCorrupt):
			out = append(out, Summary{ID: e.Name(), Name: e.Name(), Status: StatusCorrupt, Counts: newCounts()})
		case err != nil:
			continue
		default:
			out = append(out, summarize(r))
		}
	}
	// IDs start with a UTC timestamp, so reverse lexical order is newest first.
	sort.Slice(out, func(i, j int) bool { return out[i].ID > out[j].ID })
	return out, nil
}

func newCounts() Counts {
	c := Counts{Cases: map[string]int{}, Bugs: map[string]int{}}
	for _, st := range CaseStatuses {
		c.Cases[st] = 0
	}
	for _, sev := range Severities {
		c.Bugs[sev] = 0
	}
	return c
}

func summarize(r *Run) Summary {
	c := newCounts()
	for _, cs := range r.Cases {
		c.Cases[cs.Status]++
	}
	for _, b := range r.Bugs {
		c.Bugs[b.Severity]++
	}
	return Summary{ID: r.ID, Name: r.Name, BaseURL: r.BaseURL, Status: r.Status, StartedAt: r.StartedAt, EndedAt: r.EndedAt, Counts: c}
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `gofmt -l . ; go vet ./... && go test ./internal/report/ -v`
Expected: no gofmt output; all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add go.mod .gitignore internal/report
git commit -m "feat(report): add run model with atomic JSON store"
```

---
