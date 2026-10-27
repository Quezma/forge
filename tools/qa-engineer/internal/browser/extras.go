package browser

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	playwright "github.com/mxschmitt/playwright-go"
)

//go:embed axe.min.js
var axeSource string

var viewportPresets = map[string][2]int{
	"mobile":  {390, 844},
	"tablet":  {820, 1180},
	"desktop": {1440, 900},
}

// Viewport is the page size after a resize and whether content overflows it.
type Viewport struct {
	Width              int  `json:"width"`
	Height             int  `json:"height"`
	ScrollWidth        int  `json:"scroll_width"`
	HorizontalOverflow bool `json:"horizontal_overflow"`
}

// SetViewport resizes the page using a preset (mobile, tablet, desktop) or an
// explicit width and height.
func (s *Session) SetViewport(preset string, width, height int) (Viewport, error) {
	if preset != "" {
		p, ok := viewportPresets[preset]
		if !ok {
			return Viewport{}, fmt.Errorf("unknown preset %q: want mobile, tablet or desktop", preset)
		}
		width, height = p[0], p[1]
	} else if width <= 0 || height <= 0 {
		return Viewport{}, fmt.Errorf("set a preset (mobile, tablet, desktop) or a positive width and height")
	}
	if err := s.page.SetViewportSize(width, height); err != nil {
		return Viewport{}, fmt.Errorf("set viewport: %w", err)
	}
	v, err := s.page.Evaluate("document.documentElement.scrollWidth")
	if err != nil {
		return Viewport{}, fmt.Errorf("measure viewport: %w", err)
	}
	sw, _ := v.(int)
	return Viewport{Width: width, Height: height, ScrollWidth: sw, HorizontalOverflow: sw > width}, nil
}

// CookieInfo is one browser cookie.
type CookieInfo struct {
	Name     string  `json:"name"`
	Value    string  `json:"value"`
	Domain   string  `json:"domain"`
	Path     string  `json:"path"`
	HttpOnly bool    `json:"http_only"`
	Secure   bool    `json:"secure"`
	SameSite string  `json:"same_site"`
	Expires  float64 `json:"expires"`
}

// StorageState is the cookies and web storage of the current page.
type StorageState struct {
	URL            string            `json:"url"`
	Cookies        []CookieInfo      `json:"cookies"`
	LocalStorage   map[string]string `json:"local_storage"`
	SessionStorage map[string]string `json:"session_storage"`
}

const storageJS = `() => {
  const dump = (name) => { try { const st = window[name]; const o = {}; for (let i = 0; i < st.length; i++) { const k = st.key(i); o[k] = st.getItem(k); } return o; } catch (e) { return {}; } };
  return JSON.stringify({local: dump('localStorage'), session: dump('sessionStorage')});
}`

// Storage reads cookies, localStorage and sessionStorage.
func (s *Session) Storage() (StorageState, error) {
	st := StorageState{URL: s.page.URL(), Cookies: []CookieInfo{}, LocalStorage: map[string]string{}, SessionStorage: map[string]string{}}
	cookies, err := s.ctx.Cookies()
	if err != nil {
		return st, fmt.Errorf("cookies: %w", err)
	}
	for _, c := range cookies {
		ci := CookieInfo{Name: c.Name, Value: c.Value, Domain: c.Domain, Path: c.Path, HttpOnly: c.HttpOnly, Secure: c.Secure, Expires: c.Expires}
		if c.SameSite != nil {
			ci.SameSite = string(*c.SameSite)
		}
		st.Cookies = append(st.Cookies, ci)
	}
	raw, err := s.page.Evaluate(storageJS)
	if err != nil {
		return st, fmt.Errorf("web storage: %w", err)
	}
	var out struct{ Local, Session map[string]string }
	if str, _ := raw.(string); json.Unmarshal([]byte(str), &out) == nil {
		if out.Local != nil {
			st.LocalStorage = out.Local
		}
		if out.Session != nil {
			st.SessionStorage = out.Session
		}
	}
	return st, nil
}

// InterceptSpec describes a network intercept. Action is block, delay, mock or clear.
type InterceptSpec struct {
	Pattern string `json:"pattern"`
	Action  string `json:"action"`
	Status  int    `json:"status,omitempty"`
	Body    string `json:"body,omitempty"`
	DelayMs int    `json:"delay_ms,omitempty"`
}

// Intercept installs (or with "clear", removes) a route on the context.
func (s *Session) Intercept(sp InterceptSpec) error {
	if sp.Pattern == "" {
		return fmt.Errorf("intercept: pattern is required")
	}
	switch sp.Action {
	case "block":
		return s.ctx.Route(sp.Pattern, func(r playwright.Route) { r.Abort("failed") })
	case "delay":
		if sp.DelayMs <= 0 {
			return fmt.Errorf("intercept delay: delay_ms must be > 0")
		}
		return s.ctx.Route(sp.Pattern, func(r playwright.Route) {
			go func() {
				time.Sleep(time.Duration(sp.DelayMs) * time.Millisecond)
				r.Fallback()
			}()
		})
	case "mock":
		status := sp.Status
		if status == 0 {
			status = 200
		}
		ct := "text/plain; charset=utf-8"
		if b := strings.TrimSpace(sp.Body); strings.HasPrefix(b, "{") || strings.HasPrefix(b, "[") {
			ct = "application/json"
		}
		return s.ctx.Route(sp.Pattern, func(r playwright.Route) {
			r.Fulfill(playwright.RouteFulfillOptions{Status: &status, Body: sp.Body, ContentType: &ct})
		})
	case "clear":
		return s.ctx.Unroute(sp.Pattern)
	}
	return fmt.Errorf("unknown intercept action %q: want block, delay, mock, clear", sp.Action)
}

// A11yViolation is one axe-core violation with up to 5 affected selectors.
type A11yViolation struct {
	ID      string   `json:"id"`
	Impact  string   `json:"impact"`
	Help    string   `json:"help"`
	HelpURL string   `json:"help_url"`
	Nodes   []string `json:"nodes"`
}

const axeRunJS = `async () => JSON.stringify((await axe.run(document)).violations.map(v => ({
  id: v.id, impact: v.impact || '', help: v.help, help_url: v.helpUrl,
  nodes: v.nodes.slice(0, 5).map(n => n.target.join(' '))
})))`

// A11yAudit runs axe-core on the current page.
func (s *Session) A11yAudit() ([]A11yViolation, error) {
	if _, err := s.page.Evaluate(axeSource); err != nil {
		return nil, fmt.Errorf("a11y audit: inject axe: %w", err)
	}
	raw, err := s.page.Evaluate(axeRunJS)
	if err != nil {
		return nil, fmt.Errorf("a11y audit: %w", err)
	}
	out := []A11yViolation{}
	str, _ := raw.(string)
	if err := json.Unmarshal([]byte(str), &out); err != nil {
		return nil, fmt.Errorf("a11y audit: decode: %w", err)
	}
	return out, nil
}
