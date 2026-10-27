package mcp

import (
	"context"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"qa-engineer/internal/browser"
)

type navigateIn struct {
	URL       string `json:"url" jsonschema:"absolute URL to open; its host must be in allowed_hosts"`
	TimeoutMs int    `json:"timeout_ms,omitempty" jsonschema:"timeout in milliseconds (default 10000)"`
}

type refIn struct {
	Ref       string `json:"ref" jsonschema:"element ref (e.g. e12) from the latest snapshot"`
	TimeoutMs int    `json:"timeout_ms,omitempty" jsonschema:"timeout in milliseconds (default 10000)"`
}

type fillIn struct {
	Ref       string `json:"ref" jsonschema:"element ref from the latest snapshot"`
	Value     string `json:"value" jsonschema:"text to type; replaces the current value"`
	TimeoutMs int    `json:"timeout_ms,omitempty" jsonschema:"timeout in milliseconds (default 10000)"`
}

type pressIn struct {
	Key       string `json:"key" jsonschema:"key name such as Enter, Escape, Tab or ArrowDown; combos like Control+A work"`
	Ref       string `json:"ref,omitempty" jsonschema:"element ref to focus first; omit to press on the focused element"`
	TimeoutMs int    `json:"timeout_ms,omitempty" jsonschema:"timeout in milliseconds (default 10000)"`
}

type selectIn struct {
	Ref       string `json:"ref" jsonschema:"ref of a select element from the latest snapshot"`
	Value     string `json:"value" jsonschema:"option value or visible label to select"`
	TimeoutMs int    `json:"timeout_ms,omitempty" jsonschema:"timeout in milliseconds (default 10000)"`
}

type screenshotIn struct {
	Name     string `json:"name" jsonschema:"short descriptive name, used in the file name"`
	FullPage bool   `json:"full_page,omitempty" jsonschema:"capture the whole scrollable page instead of the viewport (default false)"`
}

type pathOut struct {
	Path string `json:"path" jsonschema:"path relative to the run directory; pass it as bug evidence"`
}

type logsIn struct {
	Keep bool `json:"keep,omitempty" jsonschema:"keep entries after reading (default false: the log is cleared)"`
}

type networkIn struct {
	Keep   bool   `json:"keep,omitempty" jsonschema:"keep entries after reading (default false: the log is cleared)"`
	Filter string `json:"filter,omitempty" jsonschema:"only entries whose URL contains this text"`
}

type viewportIn struct {
	Preset string `json:"preset,omitempty" jsonschema:"mobile (390x844), tablet (820x1180) or desktop (1440x900); alternative to width and height"`
	Width  int    `json:"width,omitempty" jsonschema:"viewport width in pixels (use with height)"`
	Height int    `json:"height,omitempty" jsonschema:"viewport height in pixels (use with width)"`
}

type interceptIn struct {
	URLPattern string `json:"url_pattern" jsonschema:"glob matched against request URLs, e.g. **/api/orders*"`
	Action     string `json:"action" jsonschema:"block (fail the request), delay (wait delay_ms), mock (answer with status and body) or clear (remove all intercepts)"`
	Status     int    `json:"status,omitempty" jsonschema:"HTTP status for mock (default 200)"`
	Body       string `json:"body,omitempty" jsonschema:"response body for mock"`
	DelayMs    int    `json:"delay_ms,omitempty" jsonschema:"delay in milliseconds for delay"`
}

type uploadFileIn struct {
	Ref       string               `json:"ref" jsonschema:"ref of the <input type=file> itself, or of the button, label or dropzone that opens the file chooser"`
	Paths     []string             `json:"paths,omitempty" jsonschema:"absolute paths of regular files located under the upload root (the run's uploads/ directory by default); anything else is refused"`
	Files     []browser.UploadFile `json:"files,omitempty" jsonschema:"inline files for crafted payloads (wrong MIME, double extension, script-bearing svg, path-like name): name, mime_type, and content (text) or content_base64"`
	TimeoutMs int                  `json:"timeout_ms,omitempty" jsonschema:"timeout in milliseconds (default 10000)"`
}

type empty struct{}

// bt wraps a browser tool: it resolves the active session and passes it to f.
func bt[In, Out any](s *Server, f func(*browser.Session, In) (Out, error)) func(context.Context, In) (Out, error) {
	return func(_ context.Context, in In) (Out, error) {
		_, sess, err := s.active()
		if err != nil {
			var zero Out
			return zero, err
		}
		return f(sess, in)
	}
}

// act builds a handler that runs an action and returns the page state afterwards.
func act[In any](s *Server, f func(*browser.Session, In) error) func(context.Context, In) (browser.PageInfo, error) {
	return bt(s, func(sess *browser.Session, in In) (browser.PageInfo, error) {
		if err := f(sess, in); err != nil {
			return browser.PageInfo{}, err
		}
		return sess.Info(), nil
	})
}

func nonNil[T any](v []T) []T {
	if v == nil {
		return []T{}
	}
	return v
}

func (s *Server) registerBrowserTools(m *sdk.Server) {
	addTool(s, m, "navigate", "Open a URL in the browser. The host must be in allowed_hosts.",
		bt(s, func(sess *browser.Session, in navigateIn) (browser.PageInfo, error) {
			return sess.Navigate(in.URL, in.TimeoutMs)
		}))
	addTextTool(s, m, "snapshot", "Return the page as an accessibility tree with element refs like [ref=e12]. Refs are only valid until the next snapshot.",
		bt(s, func(sess *browser.Session, _ empty) (string, error) { return sess.Snapshot() }))
	addTool(s, m, "click", "Click an element. Returns the page state afterwards.",
		act(s, func(sess *browser.Session, in refIn) error { return sess.Click(in.Ref, in.TimeoutMs) }))
	addTool(s, m, "fill", "Replace the value of an input or textarea. Returns the page state afterwards.",
		act(s, func(sess *browser.Session, in fillIn) error { return sess.Fill(in.Ref, in.Value, in.TimeoutMs) }))
	addTool(s, m, "press", "Press a keyboard key, optionally on a specific element. Returns the page state afterwards.",
		act(s, func(sess *browser.Session, in pressIn) error { return sess.Press(in.Key, in.Ref, in.TimeoutMs) }))
	addTool(s, m, "select", "Choose an option in a select element. Returns the page state afterwards.",
		act(s, func(sess *browser.Session, in selectIn) error { return sess.Select(in.Ref, in.Value, in.TimeoutMs) }))
	addTool(s, m, "hover", "Move the pointer over an element. Returns the page state afterwards.",
		act(s, func(sess *browser.Session, in refIn) error { return sess.Hover(in.Ref, in.TimeoutMs) }))

	addTool(s, m, "upload_file", "Upload one or more files through a file input, or through a button, label or dropzone that opens a native file chooser (detected automatically). Prefer inline files for crafted payloads. paths work only for regular files under the upload root (the run's uploads/ directory, or QA_ENGINEER_UPLOAD_ROOT); symlinks and .. escapes are refused, and the error names the root. the total size of all files is capped at 50 MB. Returns the files set (name, size, mime_type) and whether the chooser path was used.",
		bt(s, func(sess *browser.Session, in uploadFileIn) (browser.UploadResult, error) {
			files := append([]browser.UploadFile(nil), in.Files...)
			for _, p := range in.Paths {
				files = append(files, browser.UploadFile{Path: p})
			}
			return sess.Upload(in.Ref, files, in.TimeoutMs)
		}))
	addTool(s, m, "screenshot", "Save a PNG screenshot into the run directory and return its relative path (use it as bug evidence).",
		bt(s, func(sess *browser.Session, in screenshotIn) (pathOut, error) {
			p, err := sess.Screenshot(in.Name, in.FullPage)
			return pathOut{Path: p}, err
		}))
	addTool(s, m, "console_logs", "Return console messages and uncaught page errors since the last read.",
		bt(s, func(sess *browser.Session, in logsIn) (struct {
			Entries []browser.ConsoleEntry `json:"entries"`
		}, error) {
			return struct {
				Entries []browser.ConsoleEntry `json:"entries"`
			}{nonNil(sess.ConsoleLogs(!in.Keep))}, nil
		}))
	addTool(s, m, "network_log", "Return observed requests (method, url, status, timing, headers, failure reason) since the last read.",
		bt(s, func(sess *browser.Session, in networkIn) (struct {
			Entries []browser.NetworkEntry `json:"entries"`
		}, error) {
			return struct {
				Entries []browser.NetworkEntry `json:"entries"`
			}{nonNil(sess.NetworkLog(!in.Keep, in.Filter))}, nil
		}))
	addTool(s, m, "set_viewport", "Resize the viewport by preset or explicit size. Reports whether the page overflows horizontally.",
		bt(s, func(sess *browser.Session, in viewportIn) (browser.Viewport, error) {
			return sess.SetViewport(in.Preset, in.Width, in.Height)
		}))
	addTool(s, m, "new_context", "Discard cookies, storage, viewport and intercepts by starting a fresh browser context.",
		bt(s, func(sess *browser.Session, _ empty) (struct {
			Note string `json:"note"`
		}, error) {
			err := sess.NewContext()
			return struct {
				Note string `json:"note"`
			}{"cookies, storage, viewport and intercepts were reset; navigate to continue"}, err
		}))
	addTool(s, m, "storage", "Return cookies (with HttpOnly, Secure, SameSite flags), localStorage and sessionStorage of the current page.",
		bt(s, func(sess *browser.Session, _ empty) (browser.StorageState, error) { return sess.Storage() }))
	addTool(s, m, "intercept", "Simulate network conditions for requests matching a pattern: block, delay, mock a response, or clear all intercepts.",
		bt(s, func(sess *browser.Session, in interceptIn) (struct {
			Intercept string `json:"intercept"`
		}, error) {
			err := sess.Intercept(browser.InterceptSpec{Pattern: in.URLPattern, Action: in.Action, Status: in.Status, Body: in.Body, DelayMs: in.DelayMs})
			return struct {
				Intercept string `json:"intercept"`
			}{in.Action + " " + in.URLPattern}, err
		}))
	addTool(s, m, "a11y_audit", "Run an axe-core accessibility audit on the current page and return the violations.",
		bt(s, func(sess *browser.Session, _ empty) (struct {
			Violations []browser.A11yViolation `json:"violations"`
		}, error) {
			v, err := sess.A11yAudit()
			return struct {
				Violations []browser.A11yViolation `json:"violations"`
			}{nonNil(v)}, err
		}))
}
