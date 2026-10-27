package web

import (
	"net"
	"net/http"
	"strings"
)

// LocalOnly rejects requests whose Host header is not a loopback name.
// Binding to 127.0.0.1 is not enough: a hostile site can point its own domain
// at 127.0.0.1 (DNS rebinding) and read the reports through the browser.
func LocalOnly(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if hh, _, err := net.SplitHostPort(host); err == nil {
			host = hh
		}
		switch strings.ToLower(host) {
		case "127.0.0.1", "localhost", "::1":
			h.ServeHTTP(w, r)
		default:
			http.Error(w, "forbidden host", http.StatusForbidden)
		}
	})
}
