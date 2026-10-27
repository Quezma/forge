package browser

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	playwright "github.com/mxschmitt/playwright-go"

	"qa-engineer/internal/report"
)

// ErrBrowserUnavailable means Playwright or Chromium could not be started.
var ErrBrowserUnavailable = errors.New("browser unavailable: run `qa-engineer install`")

const (
	maxLogEntries   = 1000
	maxSnapshotSize = 60000
	defaultTimeout  = 10000
)

// Options configures Launch. ArtifactDir is the run directory.
type Options struct {
	Hosts       []string
	Headed      bool
	ArtifactDir string
	// UploadRoot confines local paths for Upload; default is ArtifactDir/uploads.
	UploadRoot string
}

// ConsoleEntry is one console message or uncaught page error.
type ConsoleEntry struct {
	Type string    `json:"type"`
	Text string    `json:"text"`
	At   time.Time `json:"at"`
}

// NetworkEntry is one observed response or failed request.
type NetworkEntry struct {
	Method     string            `json:"method"`
	URL        string            `json:"url"`
	Status     int               `json:"status,omitempty"`
	DurationMs float64           `json:"duration_ms,omitempty"`
	Headers    map[string]string `json:"headers,omitempty"`
	Failure    string            `json:"failure,omitempty"`
	At         time.Time         `json:"at"`
}

// PageInfo describes the current page.
type PageInfo struct {
	URL    string `json:"url"`
	Title  string `json:"title"`
	Status int    `json:"status,omitempty"`
}

// Session is one Chromium instance behind the host-guard proxy.
type Session struct {
	opts  Options
	guard *Guard
	proxy *Proxy
	pw    *playwright.Playwright
	br    playwright.Browser
	ctx   playwright.BrowserContext
	page  playwright.Page

	mu      sync.Mutex
	console []ConsoleEntry
	network []NetworkEntry
	shots   int
}

func appendCapped[T any](log []T, v T) []T {
	log = append(log, v)
	if len(log) > maxLogEntries {
		log = append([]T(nil), log[len(log)-maxLogEntries:]...)
	}
	return log
}

func (s *Session) addConsole(e ConsoleEntry) {
	s.mu.Lock()
	s.console = appendCapped(s.console, e)
	s.mu.Unlock()
}

func (s *Session) addNetwork(e NetworkEntry) {
	s.mu.Lock()
	s.network = appendCapped(s.network, e)
	s.mu.Unlock()
}

func timeout(ms int) float64 {
	if ms <= 0 {
		ms = defaultTimeout
	}
	return float64(ms)
}

// Launch starts the guard, proxy, Playwright and Chromium, and opens a page.
func Launch(o Options) (s *Session, err error) {
	g, err := NewGuard(o.Hosts)
	if err != nil {
		return nil, err
	}
	px, err := StartProxy(g)
	if err != nil {
		return nil, err
	}
	s = &Session{opts: o, guard: g, proxy: px}
	if o.UploadRoot == "" && o.ArtifactDir != "" {
		if err := os.MkdirAll(s.uploadRoot(), 0o755); err != nil {
			px.Close()
			return nil, err
		}
	}
	defer func() {
		if err != nil {
			s.Close()
			s = nil
		}
	}()
	s.pw, err = playwright.Run(&playwright.RunOptions{Stdout: os.Stderr, Stderr: os.Stderr})
	if err != nil {
		return s, fmt.Errorf("%w (%v)", ErrBrowserUnavailable, err)
	}
	s.br, err = s.pw.Chromium.Launch(playwright.BrowserTypeLaunchOptions{
		Headless: playwright.Bool(!o.Headed),
		Proxy:    &playwright.Proxy{Server: px.URL(), Bypass: playwright.String("<-loopback>")},
		// The proxy only sees HTTP(S). Keep every other channel from going
		// around it: WebRTC UDP, QUIC, and Chromium's own background traffic.
		Args: []string{
			"--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
			"--disable-quic",
			"--disable-background-networking",
		},
	})
	if err != nil {
		return s, fmt.Errorf("%w (%v)", ErrBrowserUnavailable, err)
	}
	if err = s.NewContext(); err != nil {
		return s, err
	}
	return s, nil
}

// NewContext discards the current context (cookies, storage, intercepts) and
// opens a fresh one with a single page.
func (s *Session) NewContext() error {
	if s.ctx != nil {
		s.ctx.Close()
		s.ctx, s.page = nil, nil
	}
	ctx, err := s.br.NewContext(playwright.BrowserNewContextOptions{
		Viewport: &playwright.Size{Width: 1440, Height: 900},
	})
	if err != nil {
		return err
	}
	page, err := ctx.NewPage()
	if err != nil {
		ctx.Close()
		return err
	}
	page.OnConsole(func(m playwright.ConsoleMessage) {
		s.addConsole(ConsoleEntry{Type: m.Type(), Text: m.Text(), At: time.Now()})
	})
	page.OnPageError(func(e error) {
		s.addConsole(ConsoleEntry{Type: "pageerror", Text: e.Error(), At: time.Now()})
	})
	page.OnResponse(func(r playwright.Response) {
		e := NetworkEntry{Method: r.Request().Method(), URL: r.URL(), Status: r.Status(), Headers: r.Headers(), At: time.Now()}
		if t := r.Request().Timing(); t != nil && t.ResponseStart > 0 {
			e.DurationMs = t.ResponseStart
		}
		if e.Headers["x-qa-guard"] == "blocked" {
			e.Failure = "blocked_by_guard"
		}
		s.addNetwork(e)
	})
	page.OnRequestFailed(func(r playwright.Request) {
		e := NetworkEntry{Method: r.Method(), URL: r.URL(), At: time.Now()}
		if f := r.Failure(); f != nil {
			e.Failure = f.Error()
		}
		if !s.guard.AllowsURL(r.URL()) {
			e.Failure = "blocked_by_guard"
		}
		s.addNetwork(e)
	})
	s.ctx, s.page = ctx, page
	return nil
}

// Info returns the current URL and title.
func (s *Session) Info() PageInfo {
	title, _ := s.page.Title()
	return PageInfo{URL: s.page.URL(), Title: title}
}

// Navigate loads rawURL if the guard allows it.
func (s *Session) Navigate(rawURL string, timeoutMs int) (PageInfo, error) {
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return PageInfo{}, fmt.Errorf("invalid url %q: want an absolute http(s) URL", rawURL)
	}
	if !s.guard.AllowsURL(rawURL) {
		return PageInfo{}, fmt.Errorf("url %q: host not in allowed_hosts", rawURL)
	}
	resp, err := s.page.Goto(rawURL, playwright.PageGotoOptions{Timeout: playwright.Float(timeout(timeoutMs))})
	if err != nil {
		return PageInfo{}, fmt.Errorf("navigate %s: %w", rawURL, err)
	}
	info := s.Info()
	if resp != nil {
		info.Status = resp.Status()
	}
	return info, nil
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	cut := strings.ToValidUTF8(s[:max], "")
	return fmt.Sprintf("%s\n[snapshot truncated at %d of %d chars: scroll, use a narrower viewport, or navigate to a more specific page]", cut, len(cut), len(s))
}

// Snapshot returns the page's AI accessibility snapshot with element refs.
func (s *Session) Snapshot() (string, error) {
	snap, err := s.page.AriaSnapshot(playwright.PageAriaSnapshotOptions{Mode: playwright.AriaSnapshotModeAi})
	if err != nil {
		return "", fmt.Errorf("snapshot: %w", err)
	}
	info := s.Info()
	return truncate(fmt.Sprintf("url: %s\ntitle: %s\n%s", info.URL, info.Title, snap), maxSnapshotSize), nil
}

var refPattern = regexp.MustCompile(`^[a-z0-9]+$`)

func (s *Session) act(action, ref string, f func(playwright.Locator) error) error {
	if !refPattern.MatchString(ref) {
		return fmt.Errorf("invalid ref %q: use a ref like e12 from snapshot", ref)
	}
	if err := f(s.page.Locator("aria-ref=" + ref)); err != nil {
		return fmt.Errorf("%s %s: %w (if the page changed, call snapshot again for fresh refs)", action, ref, err)
	}
	return nil
}

// Click clicks the element with the given snapshot ref.
func (s *Session) Click(ref string, timeoutMs int) error {
	return s.act("click", ref, func(l playwright.Locator) error {
		return l.Click(playwright.LocatorClickOptions{Timeout: playwright.Float(timeout(timeoutMs))})
	})
}

// Fill sets the value of an input.
func (s *Session) Fill(ref, value string, timeoutMs int) error {
	return s.act("fill", ref, func(l playwright.Locator) error {
		return l.Fill(value, playwright.LocatorFillOptions{Timeout: playwright.Float(timeout(timeoutMs))})
	})
}

// Hover moves the mouse over the element.
func (s *Session) Hover(ref string, timeoutMs int) error {
	return s.act("hover", ref, func(l playwright.Locator) error {
		return l.Hover(playwright.LocatorHoverOptions{Timeout: playwright.Float(timeout(timeoutMs))})
	})
}

// Select chooses an option by value in a <select>.
func (s *Session) Select(ref, value string, timeoutMs int) error {
	return s.act("select", ref, func(l playwright.Locator) error {
		_, err := l.SelectOption(playwright.SelectOptionValues{Values: &[]string{value}},
			playwright.LocatorSelectOptionOptions{Timeout: playwright.Float(timeout(timeoutMs))})
		return err
	})
}

// Press presses a key, on the element if ref is set, else on the page.
func (s *Session) Press(key, ref string, timeoutMs int) error {
	if ref == "" {
		if err := s.page.Keyboard().Press(key); err != nil {
			return fmt.Errorf("press %s: %w", key, err)
		}
		return nil
	}
	return s.act("press", ref, func(l playwright.Locator) error {
		return l.Press(key, playwright.LocatorPressOptions{Timeout: playwright.Float(timeout(timeoutMs))})
	})
}

// Screenshot saves a PNG and returns its path relative to ArtifactDir.
func (s *Session) Screenshot(name string, fullPage bool) (string, error) {
	s.mu.Lock()
	s.shots++
	n := s.shots
	s.mu.Unlock()
	rel := fmt.Sprintf("screenshots/%d-%s.png", n, report.Slug(name))
	abs := filepath.Join(s.opts.ArtifactDir, rel)
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return "", err
	}
	if _, err := s.page.Screenshot(playwright.PageScreenshotOptions{Path: playwright.String(abs), FullPage: playwright.Bool(fullPage)}); err != nil {
		return "", fmt.Errorf("screenshot: %w", err)
	}
	return rel, nil
}

// ConsoleLogs returns a copy of the console log, optionally clearing it.
func (s *Session) ConsoleLogs(clear bool) []ConsoleEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := append([]ConsoleEntry{}, s.console...)
	if clear {
		s.console = nil
	}
	return out
}

// NetworkLog returns a copy of the network log filtered by URL substring.
func (s *Session) NetworkLog(clear bool, filter string) []NetworkEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []NetworkEntry{}
	for _, e := range s.network {
		if strings.Contains(e.URL, filter) {
			out = append(out, e)
		}
	}
	if clear {
		s.network = nil
	}
	return out
}

// Close shuts down browser, driver and proxy, joining any errors.
func (s *Session) Close() error {
	var errs []error
	if s.br != nil {
		errs = append(errs, s.br.Close())
	}
	if s.pw != nil {
		errs = append(errs, s.pw.Stop())
	}
	if s.proxy != nil {
		errs = append(errs, s.proxy.Close())
	}
	return errors.Join(errs...)
}
