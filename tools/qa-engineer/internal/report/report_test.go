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
