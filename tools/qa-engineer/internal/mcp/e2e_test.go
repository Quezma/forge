package mcp

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"qa-engineer/internal/fixtureapp"
	"qa-engineer/internal/report"
)

type startOut struct {
	RunID  string `json:"run_id"`
	RunDir string `json:"run_dir"`
}

// startFixtureRun starts a run against the fixture app, skipping when Chromium is missing.
func startFixtureRun(t *testing.T) (*Server, *sdk.ClientSession, report.Store, startOut) {
	t.Helper()
	srv, cs, store := newTestServer(t)
	app := httptest.NewServer(fixtureapp.Handler())
	t.Cleanup(app.Close)
	res := call(t, cs, "start_run", map[string]any{
		"name": "login flow", "base_url": app.URL,
		"allowed_hosts": []string{strings.TrimPrefix(app.URL, "http://")},
	})
	if res.IsError {
		if strings.Contains(text(res), "qa-engineer install") {
			t.Skip(text(res))
		}
		t.Fatal(text(res))
	}
	var out startOut
	decode(t, res, &out)
	t.Cleanup(func() { srv.Shutdown() })
	return srv, cs, store, out
}

func refFor(t *testing.T, snap, substr string) string {
	t.Helper()
	for _, line := range strings.Split(snap, "\n") {
		if strings.Contains(line, substr) {
			if i := strings.Index(line, "[ref="); i >= 0 {
				return strings.SplitN(line[i+5:], "]", 2)[0]
			}
		}
	}
	t.Fatalf("no ref for %q in:\n%s", substr, snap)
	return ""
}

func TestQAFlowEndToEnd(t *testing.T) {
	_, cs, store, start := startFixtureRun(t)

	snap := text(callOK(t, cs, "snapshot", map[string]any{}, nil))
	callOK(t, cs, "fill", map[string]any{"ref": refFor(t, snap, `textbox "Email"`), "value": "QA@example.com"}, nil)
	callOK(t, cs, "fill", map[string]any{"ref": refFor(t, snap, `textbox "Password"`), "value": fixtureapp.Password}, nil)
	callOK(t, cs, "click", map[string]any{"ref": refFor(t, snap, `button "Sign in"`)}, nil)

	deadline := time.Now().Add(5 * time.Second)
	for !strings.Contains(text(callOK(t, cs, "snapshot", map[string]any{}, nil)), "Invalid email or password") {
		if time.Now().After(deadline) {
			t.Fatal("error message never appeared")
		}
		time.Sleep(100 * time.Millisecond)
	}

	var nl struct {
		Entries []struct {
			URL    string `json:"url"`
			Status int    `json:"status"`
		} `json:"entries"`
	}
	callOK(t, cs, "network_log", map[string]any{"filter": "/api/login"}, &nl)
	if len(nl.Entries) == 0 || nl.Entries[0].Status != 401 {
		t.Fatalf("network_log = %+v, want a 401 for /api/login", nl.Entries)
	}

	var shot struct {
		Path string `json:"path"`
	}
	callOK(t, cs, "screenshot", map[string]any{"name": "uppercase email rejected"}, &shot)
	if shot.Path == "" {
		t.Fatal("empty screenshot path")
	}

	callOK(t, cs, "record_case", map[string]any{"name": "login with uppercase email", "category": "functional", "status": "fail"}, nil)
	callOK(t, cs, "report_bug", map[string]any{
		"title": "Uppercase email rejected", "severity": "medium", "category": "functional",
		"steps":    []string{"open login", "enter QA@example.com and valid password", "click Sign in"},
		"expected": "login succeeds (emails are case-insensitive)", "actual": "Invalid email or password",
		"evidence": []string{shot.Path},
	}, nil)

	if msg := callErr(t, cs, "start_run", map[string]any{"name": "again", "base_url": "http://x.test", "allowed_hosts": []string{"x.test"}}); !strings.Contains(msg, "end_run") {
		t.Errorf("second start_run error %q should mention end_run", msg)
	}

	var end struct {
		RunID     string `json:"run_id"`
		Cases     int    `json:"cases"`
		Bugs      int    `json:"bugs"`
		Dashboard string `json:"dashboard"`
	}
	callOK(t, cs, "end_run", map[string]any{"summary": "login has a case bug"}, &end)
	if end.RunID != start.RunID || end.Cases != 1 || end.Bugs != 1 || !strings.Contains(end.Dashboard, start.RunID) {
		t.Fatalf("end_run = %+v", end)
	}

	run, err := store.Load(start.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != report.StatusCompleted || run.Summary != "login has a case bug" || len(run.Cases) != 1 || len(run.Bugs) != 1 {
		t.Fatalf("run = %+v", run)
	}
	if ev := run.Bugs[0].Evidence; len(ev) != 1 || ev[0] != shot.Path {
		t.Errorf("evidence = %v, want [%s]", ev, shot.Path)
	}
}

func TestShutdownMarksRunIncomplete(t *testing.T) {
	srv, cs, store, start := startFixtureRun(t)
	if err := srv.Shutdown(); err != nil {
		t.Fatal(err)
	}
	run, err := store.Load(start.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != report.StatusIncomplete {
		t.Errorf("status = %q, want incomplete", run.Status)
	}
	if msg := callErr(t, cs, "snapshot", map[string]any{}); !strings.Contains(msg, "start_run") {
		t.Errorf("error %q should mention start_run", msg)
	}
}

func TestUploadFileTool(t *testing.T) {
	_, cs, _, _ := startFixtureRun(t)
	first := text(callOK(t, cs, "snapshot", map[string]any{}, nil))
	base := strings.TrimPrefix(strings.SplitN(first, "\n", 2)[0], "url: ")
	callOK(t, cs, "navigate", map[string]any{"url": base + "upload-button"}, nil)
	snap := text(callOK(t, cs, "snapshot", map[string]any{}, nil))
	var out struct {
		Files []struct {
			Name     string `json:"name"`
			Size     int    `json:"size"`
			MimeType string `json:"mime_type"`
		} `json:"files"`
		UsedChooser bool `json:"used_chooser"`
	}
	callOK(t, cs, "upload_file", map[string]any{
		"ref":   refFor(t, snap, `button "Attach"`),
		"files": []map[string]any{{"name": "evil.php.jpg", "mime_type": "image/jpeg", "content": "<?php ?>"}},
	}, &out)
	if !out.UsedChooser || len(out.Files) != 1 || out.Files[0].Name != "evil.php.jpg" || out.Files[0].Size != 8 {
		t.Fatalf("upload_file = %+v", out)
	}
	if msg := callErr(t, cs, "upload_file", map[string]any{"ref": "e1", "paths": []string{"relative.txt"}}); !strings.Contains(msg, "absolute") {
		t.Errorf("error %q should mention absolute", msg)
	}
}
