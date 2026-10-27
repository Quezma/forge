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
