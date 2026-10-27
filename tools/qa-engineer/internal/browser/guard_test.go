package browser

import "testing"

func TestNewGuardRejects(t *testing.T) {
	cases := [][]string{nil, {}, {""}, {"http://x.com"}, {"x.com/path"}, {"*"}, {"a.*.com"}, {"user@x.com"}}
	for _, hosts := range cases {
		if _, err := NewGuard(hosts); err == nil {
			t.Errorf("NewGuard(%q) succeeded, want error", hosts)
		}
	}
}

func TestAllowsURL(t *testing.T) {
	g, err := NewGuard([]string{"localhost:3000", "api.example.com", "*.cdn.example.com", "127.0.0.1"})
	if err != nil {
		t.Fatal(err)
	}
	tests := map[string]bool{
		"http://localhost:3000/login":        true,
		"http://LOCALHOST:3000/":             true,
		"http://localhost:3001/":             false,
		"http://localhost/":                  false,
		"https://api.example.com/v1":         true,
		"http://api.example.com:8080/":       true,
		"https://other.example.com/":         false,
		"https://api.example.com.other.net/": false,
		"https://img.cdn.example.com/a.png":  true,
		"https://cdn.example.com/a.png":      false,
		"https://a.b.cdn.example.com/":       true,
		"ws://localhost:3000/socket":         true,
		"http://127.0.0.1:9999/":             true,
		"file:///etc/hosts":                  false,
		"chrome://settings":                  false,
		"about:blank":                        true,
		"data:text/html,hi":                  true,
		"::not a url":                        false,
	}
	for u, want := range tests {
		if got := g.AllowsURL(u); got != want {
			t.Errorf("AllowsURL(%q) = %v, want %v", u, got, want)
		}
	}
}
