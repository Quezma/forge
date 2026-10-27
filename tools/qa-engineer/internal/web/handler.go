package web

import (
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"path/filepath"
	"strings"

	"qa-engineer/internal/report"
)

// Handler serves the read-only runs API plus the SPA from assets.
func Handler(store report.Store, assets fs.FS) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/runs", func(w http.ResponseWriter, r *http.Request) {
		runs, err := store.List()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, runs)
	})
	mux.HandleFunc("GET /api/runs/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if !report.ValidID(id) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid run id"})
			return
		}
		run, err := store.Load(id)
		switch {
		case errors.Is(err, fs.ErrNotExist):
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "run not found"})
		case err != nil:
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		default:
			writeJSON(w, http.StatusOK, run)
		}
	})
	mux.HandleFunc("GET /api/runs/{id}/screenshots/{file}", func(w http.ResponseWriter, r *http.Request) {
		id, file := r.PathValue("id"), r.PathValue("file")
		if !report.ValidID(id) || filepath.Base(file) != file || !filepath.IsLocal(file) || !strings.HasSuffix(file, ".png") {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid screenshot path"})
			return
		}
		http.ServeFile(w, r, filepath.Join(store.RunDir(id), "screenshots", file))
	})
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
	})
	files := http.FileServerFS(assets)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { // no method: "GET /" would conflict with "/api/"
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		name := strings.TrimPrefix(r.URL.Path, "/")
		if info, err := fs.Stat(assets, name); err == nil && !info.IsDir() {
			files.ServeHTTP(w, r)
			return
		}
		index, err := fs.ReadFile(assets, "index.html")
		if err != nil {
			http.Error(w, "dashboard not built: run make build", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(index)
	})
	return mux
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
