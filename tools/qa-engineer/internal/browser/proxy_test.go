package browser

import (
	"crypto/tls"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync/atomic"
	"testing"
)

func hostOf(t *testing.T, raw string) string {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return u.Host
}

func proxyClient(t *testing.T, allowed ...string) *http.Client {
	t.Helper()
	g, err := NewGuard(allowed)
	if err != nil {
		t.Fatal(err)
	}
	p, err := StartProxy(g)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { p.Close() })
	pu, _ := url.Parse(p.URL())
	return &http.Client{Transport: &http.Transport{
		Proxy:           http.ProxyURL(pu),
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}}
}

func countingServer(t *testing.T, tls bool, h http.HandlerFunc) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var hits atomic.Int32
	wrapped := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		h(w, r)
	})
	var s *httptest.Server
	if tls {
		s = httptest.NewTLSServer(wrapped)
	} else {
		s = httptest.NewServer(wrapped)
	}
	t.Cleanup(s.Close)
	return s, &hits
}

func ok(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "hello") }

func TestProxyAllowedHTTP(t *testing.T) {
	s, _ := countingServer(t, false, ok)
	c := proxyClient(t, hostOf(t, s.URL))
	resp, err := c.Get(s.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 || string(body) != "hello" {
		t.Fatalf("got %d %q", resp.StatusCode, body)
	}
}

func TestProxyBlocksDisallowedHTTP(t *testing.T) {
	allowed, _ := countingServer(t, false, ok)
	other, hits := countingServer(t, false, ok)
	c := proxyClient(t, hostOf(t, allowed.URL))
	resp, err := c.Get(other.URL)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 403 || resp.Header.Get(GuardHeader) != "blocked" {
		t.Fatalf("got %d, header %q", resp.StatusCode, resp.Header.Get(GuardHeader))
	}
	if hits.Load() != 0 {
		t.Fatal("disallowed server was hit")
	}
}

func TestProxyBlocksRedirectHop(t *testing.T) {
	other, hits := countingServer(t, false, ok)
	mux := http.NewServeMux()
	mux.HandleFunc("/a", func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, "/b", http.StatusFound) })
	mux.HandleFunc("/b", func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, other.URL, http.StatusFound) })
	allowed := httptest.NewServer(mux)
	t.Cleanup(allowed.Close)
	c := proxyClient(t, hostOf(t, allowed.URL))
	resp, err := c.Get(allowed.URL + "/a")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 403 || hits.Load() != 0 {
		t.Fatalf("status %d, other hits %d", resp.StatusCode, hits.Load())
	}
}

func TestProxyAllowedHTTPS(t *testing.T) {
	s, _ := countingServer(t, true, ok)
	c := proxyClient(t, hostOf(t, s.URL))
	resp, err := c.Get(s.URL)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status %d", resp.StatusCode)
	}
}

func TestProxyBlocksDisallowedHTTPS(t *testing.T) {
	allowed, _ := countingServer(t, true, ok)
	other, hits := countingServer(t, true, ok)
	c := proxyClient(t, hostOf(t, allowed.URL))
	if resp, err := c.Get(other.URL); err == nil {
		resp.Body.Close()
		t.Fatalf("expected client error, got status %d", resp.StatusCode)
	}
	if hits.Load() != 0 {
		t.Fatal("disallowed server was hit")
	}
}
