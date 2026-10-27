package browser

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"qa-engineer/internal/fixtureapp"
)

func launchFixture(t *testing.T) (*Session, string) {
	t.Helper()
	srv := httptest.NewServer(fixtureapp.Handler())
	t.Cleanup(srv.Close)
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "screenshots"), 0o755); err != nil {
		t.Fatal(err)
	}
	s, err := Launch(Options{Hosts: []string{strings.TrimPrefix(srv.URL, "http://")}, ArtifactDir: dir})
	if errors.Is(err, ErrBrowserUnavailable) {
		t.Skip(err)
	}
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s, srv.URL
}

var refRe = regexp.MustCompile(`\[ref=([a-z0-9]+)\]`)

func refFor(t *testing.T, snap, substr string) string {
	t.Helper()
	for _, line := range strings.Split(snap, "\n") {
		if strings.Contains(line, substr) {
			if m := refRe.FindStringSubmatch(line); m != nil {
				return m[1]
			}
		}
	}
	t.Fatalf("no ref for %q in:\n%s", substr, snap)
	return ""
}

func eventually(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func snap(t *testing.T, s *Session) string {
	t.Helper()
	out, err := s.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func login(t *testing.T, s *Session, base, password string) {
	t.Helper()
	if _, err := s.Navigate(base+"/", 0); err != nil {
		t.Fatal(err)
	}
	sn := snap(t, s)
	for _, a := range []error{
		s.Fill(refFor(t, sn, `textbox "Email"`), fixtureapp.Email, 0),
		s.Fill(refFor(t, sn, `textbox "Password"`), password, 0),
		s.Click(refFor(t, sn, `button "Sign in"`), 0),
	} {
		if a != nil {
			t.Fatal(a)
		}
	}
}

func TestNavigateAndSnapshot(t *testing.T) {
	s, base := launchFixture(t)
	info, err := s.Navigate(base+"/", 0)
	if err != nil {
		t.Fatal(err)
	}
	if info.Status != 200 || info.Title != "Acme Login" {
		t.Fatalf("info = %+v", info)
	}
	sn := snap(t, s)
	for _, want := range []string{`textbox "Email"`, `button "Sign in"`} {
		if !strings.Contains(sn, want) {
			t.Errorf("snapshot missing %q:\n%s", want, sn)
		}
	}
}

func TestLoginWithRefs(t *testing.T) {
	s, base := launchFixture(t)
	login(t, s, base, fixtureapp.Password)
	eventually(t, "dashboard", func() bool { return strings.HasSuffix(s.Info().URL, "/dashboard") })
}

func TestNetworkLogCapturesFailedLogin(t *testing.T) {
	s, base := launchFixture(t)
	login(t, s, base, "wrong")
	eventually(t, "401", func() bool {
		for _, e := range s.NetworkLog(false, "/api/login") {
			if e.Status == 401 {
				return true
			}
		}
		return false
	})
}

func TestConsoleLogsCapturesErrors(t *testing.T) {
	s, base := launchFixture(t)
	if _, err := s.Navigate(base+"/console-error", 0); err != nil {
		t.Fatal(err)
	}
	has := func(typ, text string) bool {
		for _, e := range s.ConsoleLogs(false) {
			if e.Type == typ && strings.Contains(e.Text, text) {
				return true
			}
		}
		return false
	}
	eventually(t, "console entries", func() bool {
		return has("error", "failed to load widgets") && has("pageerror", "boom")
	})
	s.ConsoleLogs(true)
	if got := s.ConsoleLogs(false); len(got) != 0 {
		t.Fatalf("after clear: %v", got)
	}
}

func TestGuardBlocksDisallowedHosts(t *testing.T) {
	s, base := launchFixture(t)
	var hits atomic.Int32
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
	}))
	defer other.Close()

	if _, err := s.Navigate(other.URL+"/x", 0); err == nil || !strings.Contains(err.Error(), "allowed_hosts") {
		t.Fatalf("direct navigate err = %v", err)
	}
	info, err := s.Navigate(base+"/go?to="+other.URL+"/x", 0)
	if err != nil {
		t.Fatal(err)
	}
	if info.Status != 403 {
		t.Errorf("redirect status = %d, want 403", info.Status)
	}
	if hits.Load() != 0 {
		t.Errorf("disallowed server got %d hits", hits.Load())
	}
	blocked := false
	for _, e := range s.NetworkLog(false, "") {
		if e.Failure == "blocked_by_guard" {
			blocked = true
		}
	}
	if !blocked {
		t.Errorf("no blocked_by_guard entry: %+v", s.NetworkLog(false, ""))
	}
}

func TestScreenshot(t *testing.T) {
	s, base := launchFixture(t)
	if _, err := s.Navigate(base+"/", 0); err != nil {
		t.Fatal(err)
	}
	p, err := s.Screenshot("Login page", false)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(p, "screenshots/1-") {
		t.Fatalf("path = %q", p)
	}
	if _, err := os.Stat(filepath.Join(s.opts.ArtifactDir, p)); err != nil {
		t.Fatal(err)
	}
}

func TestStaleRefGivesActionableError(t *testing.T) {
	s, base := launchFixture(t)
	if _, err := s.Navigate(base+"/", 0); err != nil {
		t.Fatal(err)
	}
	ref := refFor(t, snap(t, s), `button "Sign in"`)
	if _, err := s.Navigate(base+"/console-error", 0); err != nil {
		t.Fatal(err)
	}
	err := s.Click(ref, 1000)
	if err == nil || !strings.Contains(err.Error(), "snapshot again") {
		t.Fatalf("err = %v", err)
	}
}

func TestTruncateSnapshot(t *testing.T) {
	if got := truncate("short", 100); got != "short" {
		t.Errorf("short = %q", got)
	}
	got := truncate(strings.Repeat("é", 100), 51)
	if !strings.Contains(got, "truncated") || !strings.HasPrefix(got, strings.Repeat("é", 25)) {
		t.Errorf("long = %q", got)
	}
}

func TestLogsAreCapped(t *testing.T) {
	s := &Session{}
	for i := 0; i < 1100; i++ {
		s.addConsole(ConsoleEntry{Type: "log", Text: fmt.Sprint(i)})
	}
	got := s.ConsoleLogs(false)
	if len(got) != 1000 || got[0].Text != "100" {
		t.Fatalf("len=%d first=%q", len(got), got[0].Text)
	}
}

func TestInvalidRef(t *testing.T) {
	s := &Session{}
	for _, ref := range []string{"", "E1", "e1; x", "aria-ref=e1"} {
		if err := s.Click(ref, 0); err == nil || !strings.Contains(err.Error(), "invalid ref") {
			t.Errorf("ref %q: err = %v", ref, err)
		}
	}
}
