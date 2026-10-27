package web

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"qa-engineer/internal/report"
)

var t0 = time.Date(2026, 10, 3, 12, 0, 0, 0, time.UTC)

func setup(t *testing.T, assets fstest.MapFS) (http.Handler, string) {
	t.Helper()
	store := report.Store{Dir: t.TempDir()}
	r, err := store.Create("Login Flow", "http://localhost:3000", []string{"localhost:3000"}, "", t0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := r.AddCase(report.Case{Name: "valid login", Category: "functional", Status: "pass"}, t0); err != nil {
		t.Fatal(err)
	}
	shots := filepath.Join(store.RunDir(r.ID), "screenshots")
	if err := os.MkdirAll(shots, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(shots, "1.png"), []byte("png-bytes"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := r.AddBug(report.Bug{Title: "b", Severity: "high", Category: "ui", Steps: []string{"s"}, Expected: "e", Actual: "a", Evidence: []string{"screenshots/1.png"}}, store.RunDir(r.ID), t0); err != nil {
		t.Fatal(err)
	}
	if err := store.Save(r); err != nil {
		t.Fatal(err)
	}
	bad := store.RunDir("bad-run")
	if err := os.MkdirAll(bad, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bad, "run.json"), []byte("{nope"), 0o644); err != nil {
		t.Fatal(err)
	}
	return Handler(store, assets), r.ID
}

func get(h http.Handler, path string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
	return w
}

func TestAPI(t *testing.T) {
	assets := fstest.MapFS{"index.html": {Data: []byte("<html>spa</html>")}, "assets/app.js": {Data: []byte("console.log(1)")}}
	h, id := setup(t, assets)

	tests := []struct {
		name, path string
		code       int
		contains   string
		ctype      string
	}{
		{"list", "/api/runs", 200, "corrupt", "application/json"},
		{"list has run", "/api/runs", 200, id, "application/json"},
		{"get", "/api/runs/" + id, 200, "Login Flow", "application/json"},
		{"get unknown", "/api/runs/nope", 404, "error", "application/json"},
		{"get invalid id", "/api/runs/bad%20id", 400, "error", "application/json"},
		{"get corrupt", "/api/runs/bad-run", 500, "corrupt", "application/json"},
		{"screenshot", "/api/runs/" + id + "/screenshots/1.png", 200, "png-bytes", "image/png"},
		{"screenshot traversal", "/api/runs/" + id + "/screenshots/..%2Frun.json", 400, "", ""},
		{"screenshot not png", "/api/runs/" + id + "/screenshots/x.txt", 400, "", ""},
		{"screenshot missing", "/api/runs/" + id + "/screenshots/9.png", 404, "", ""},
		{"screenshot invalid id", "/api/runs/bad%20id/screenshots/1.png", 400, "", ""},
		{"unknown api", "/api/nope", 404, "error", "application/json"},
		{"spa root", "/", 200, "spa", "text/html; charset=utf-8"},
		{"spa route", "/runs/abc", 200, "spa", "text/html; charset=utf-8"},
		{"asset", "/assets/app.js", 200, "console.log(1)", ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			w := get(h, tc.path)
			if w.Code != tc.code {
				t.Fatalf("status = %d, want %d (body %q)", w.Code, tc.code, w.Body.String())
			}
			if !strings.Contains(w.Body.String(), tc.contains) {
				t.Errorf("body %q missing %q", w.Body.String(), tc.contains)
			}
			if tc.ctype != "" && w.Header().Get("Content-Type") != tc.ctype {
				t.Errorf("content-type = %q, want %q", w.Header().Get("Content-Type"), tc.ctype)
			}
		})
	}
}

func TestMissingIndex(t *testing.T) {
	h, _ := setup(t, fstest.MapFS{})
	w := get(h, "/")
	if w.Code != 404 || !strings.Contains(w.Body.String(), "make build") {
		t.Fatalf("got %d %q, want 404 mentioning make build", w.Code, w.Body.String())
	}
}
