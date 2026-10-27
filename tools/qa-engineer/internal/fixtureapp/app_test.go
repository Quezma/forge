package fixtureapp

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func newClient(t *testing.T) (*http.Client, string) {
	t.Helper()
	s := httptest.NewServer(Handler())
	t.Cleanup(s.Close)
	return &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, s.URL
}

func login(c *http.Client, base, body string) (*http.Response, string) {
	resp, err := c.Post(base+"/api/login", "application/json", strings.NewReader(body))
	if err != nil {
		panic(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp, string(b)
}

func TestLoginPage(t *testing.T) {
	c, base := newClient(t)
	resp, err := c.Get(base + "/")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 || !strings.Contains(string(b), `id="email"`) {
		t.Fatalf("status %d, body %s", resp.StatusCode, b)
	}
}

func TestLogin(t *testing.T) {
	tests := []struct {
		name, body string
		status     int
		cookie     bool
	}{
		{"valid", `{"email":"qa@example.com","password":"Secret123!"}`, 200, true},
		{"uppercase email", `{"email":"QA@example.com","password":"Secret123!"}`, 401, false},
		{"padded email", `{"email":" qa@example.com ","password":"Secret123!"}`, 401, false},
		{"wrong password", `{"email":"qa@example.com","password":"nope"}`, 401, false},
		{"empty email", `{"email":"","password":"Secret123!"}`, 500, false},
		{"bad json", `{nope`, 400, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, base := newClient(t)
			resp, body := login(c, base, tt.body)
			if resp.StatusCode != tt.status {
				t.Fatalf("status %d, want %d (%s)", resp.StatusCode, tt.status, body)
			}
			var found bool
			for _, ck := range resp.Cookies() {
				if ck.Name == "session" && ck.HttpOnly {
					found = true
				}
			}
			if found != tt.cookie {
				t.Fatalf("session cookie = %v, want %v", found, tt.cookie)
			}
			if tt.status == 500 && !strings.Contains(body, "Internal Server Error") {
				t.Fatalf("body = %q", body)
			}
		})
	}
}

func TestDashboardAndLogout(t *testing.T) {
	c, base := newClient(t)
	resp, _ := c.Get(base + "/dashboard")
	if resp.StatusCode != 302 || resp.Header.Get("Location") != "/" {
		t.Fatalf("no cookie: %d %q", resp.StatusCode, resp.Header.Get("Location"))
	}

	lr, _ := login(c, base, `{"email":"qa@example.com","password":"Secret123!"}`)
	cookie := lr.Cookies()[0]
	get := func(path string) *http.Response {
		req, _ := http.NewRequest("GET", base+path, nil)
		req.AddCookie(cookie)
		r, err := c.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	r := get("/dashboard")
	b, _ := io.ReadAll(r.Body)
	r.Body.Close()
	if r.StatusCode != 200 || !strings.Contains(string(b), "Welcome back") {
		t.Fatalf("dashboard: %d %s", r.StatusCode, b)
	}
	if lo := get("/logout"); lo.StatusCode != 302 {
		t.Fatalf("logout: %d", lo.StatusCode)
	}
	if r := get("/dashboard"); r.StatusCode != 302 {
		t.Fatalf("after logout: %d", r.StatusCode)
	}
}

func TestGoRedirects(t *testing.T) {
	c, base := newClient(t)
	resp, _ := c.Get(base + "/go?to=http://example.test/x")
	if resp.StatusCode != 302 || resp.Header.Get("Location") != "http://example.test/x" {
		t.Fatalf("%d %q", resp.StatusCode, resp.Header.Get("Location"))
	}
}
