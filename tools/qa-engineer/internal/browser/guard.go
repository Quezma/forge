// Package browser drives a Chromium instance for QA runs and keeps it inside
// an allowlist of hosts.
package browser

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"
)

type hostRule struct {
	host     string
	port     string // empty: any port
	wildcard bool   // match subdomains only
}

// Guard decides whether a host:port or URL is inside the allowlist.
type Guard struct{ rules []hostRule }

// NewGuard parses allowlist entries: "host", "host:port", "*.domain" or
// "*.domain:port". A bare host matches any port; a wildcard matches any
// subdomain but not the apex domain.
func NewGuard(hosts []string) (*Guard, error) {
	if len(hosts) == 0 {
		return nil, errors.New("allowed_hosts must not be empty")
	}
	g := &Guard{}
	for _, raw := range hosts {
		e := strings.ToLower(strings.TrimSpace(raw))
		if e == "" || strings.ContainsAny(e, "/@?#") {
			return nil, fmt.Errorf("invalid allowed host %q: want host, host:port or *.domain", raw)
		}
		r := hostRule{host: e}
		if h, p, err := net.SplitHostPort(e); err == nil {
			r.host, r.port = h, p
		}
		if rest, ok := strings.CutPrefix(r.host, "*."); ok {
			r.host, r.wildcard = rest, true
		}
		if r.host == "" || strings.Contains(r.host, "*") {
			return nil, fmt.Errorf("invalid allowed host %q: wildcard only allowed as a leading *.", raw)
		}
		g.rules = append(g.rules, r)
	}
	return g, nil
}

// AllowsHostPort reports whether host:port matches any rule.
func (g *Guard) AllowsHostPort(host, port string) bool {
	host = strings.ToLower(host)
	for _, r := range g.rules {
		if r.port != "" && r.port != port {
			continue
		}
		if r.wildcard {
			if strings.HasSuffix(host, "."+r.host) {
				return true
			}
		} else if host == r.host {
			return true
		}
	}
	return false
}

// AllowsURL reports whether the browser may load raw. about:, data: and blob:
// URLs are always fine; http(s)/ws(s) are checked against the rules; any
// other scheme (file, chrome, ftp, ...) is denied.
func (g *Guard) AllowsURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	var defPort string
	switch strings.ToLower(u.Scheme) {
	case "about", "data", "blob":
		return true
	case "http", "ws":
		defPort = "80"
	case "https", "wss":
		defPort = "443"
	default:
		return false
	}
	port := u.Port()
	if port == "" {
		port = defPort
	}
	return g.AllowsHostPort(u.Hostname(), port)
}
