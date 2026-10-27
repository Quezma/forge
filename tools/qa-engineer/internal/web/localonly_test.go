package web

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLocalOnlyRejectsForeignHosts(t *testing.T) {
	h := LocalOnly(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	for host, want := range map[string]int{
		"127.0.0.1:7777":        http.StatusOK,
		"localhost:7777":        http.StatusOK,
		"LOCALHOST":             http.StatusOK,
		"[::1]:7777":            http.StatusOK,
		"rebind.example.com":    http.StatusForbidden,
		"attacker.test:7777":    http.StatusForbidden,
		"127.0.0.1.nip.io:7777": http.StatusForbidden,
	} {
		req := httptest.NewRequest("GET", "/api/runs", nil)
		req.Host = host
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != want {
			t.Errorf("Host %q: status %d, want %d", host, rec.Code, want)
		}
	}
}
