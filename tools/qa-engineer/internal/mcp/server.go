// Package mcp exposes the QA browser and reporting tools over the Model Context Protocol.
package mcp

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"qa-engineer/internal/browser"
	"qa-engineer/internal/report"
)

// Version is the server version reported to MCP clients.
const Version = "0.1.0"

var errNoRun = errors.New("no active run: call start_run first")

// Server holds the single active run and its browser session.
type Server struct {
	store report.Store
	now   func() time.Time

	uploadRoot string // from QA_ENGINEER_UPLOAD_ROOT at start; never from tool input

	mu   sync.Mutex
	run  *report.Run
	sess *browser.Session
}

// New returns a server that persists runs in store.
func New(store report.Store) *Server {
	return &Server{store: store, now: time.Now, uploadRoot: os.Getenv("QA_ENGINEER_UPLOAD_ROOT")}
}

// MCP builds the MCP server with all tools registered.
func (s *Server) MCP() *sdk.Server {
	m := sdk.NewServer(&sdk.Implementation{Name: "qa-engineer", Version: Version}, &sdk.ServerOptions{Instructions: instructions})
	s.registerRunTools(m)
	s.registerBrowserTools(m)
	s.registerReportTools(m)
	return m
}

// Shutdown ends an active run as incomplete, e.g. when the client disconnects.
func (s *Server) Shutdown() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.run == nil {
		return nil
	}
	return s.finish(report.StatusIncomplete, "")
}

// finish closes the browser, saves the run with the given status and clears it. Caller holds s.mu.
func (s *Server) finish(status, summary string) error {
	var closeErr error
	if s.sess != nil {
		closeErr = s.sess.Close()
	}
	end := s.now()
	s.run.Status = status
	s.run.EndedAt = &end
	if summary != "" {
		s.run.Summary = summary
	}
	err := s.store.Save(s.run)
	s.run, s.sess = nil, nil
	return errors.Join(err, closeErr)
}

// active returns the current run and session or errNoRun. Caller holds s.mu.
func (s *Server) active() (*report.Run, *browser.Session, error) {
	if s.run == nil || s.sess == nil {
		return nil, nil, errNoRun
	}
	return s.run, s.sess, nil
}

func (s *Server) call(name string, f func() error) (err error) {
	// ponytail: one lock, since Claude drives a run sequentially; per-tool locks if tools ever run concurrently.
	s.mu.Lock()
	defer s.mu.Unlock()
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("internal error in %s: %v", name, r)
		}
	}()
	return f()
}

func addTool[In, Out any](s *Server, m *sdk.Server, name, desc string, h func(context.Context, In) (Out, error)) {
	sdk.AddTool(m, &sdk.Tool{Name: name, Description: desc}, func(ctx context.Context, _ *sdk.CallToolRequest, in In) (*sdk.CallToolResult, Out, error) {
		var out Out
		err := s.call(name, func() (e error) { out, e = h(ctx, in); return })
		return nil, out, err
	})
}

// addTextTool registers a tool whose string result is returned as plain text rather than JSON.
func addTextTool[In any](s *Server, m *sdk.Server, name, desc string, h func(context.Context, In) (string, error)) {
	sdk.AddTool(m, &sdk.Tool{Name: name, Description: desc}, func(ctx context.Context, _ *sdk.CallToolRequest, in In) (*sdk.CallToolResult, any, error) {
		var out string
		if err := s.call(name, func() (e error) { out, e = h(ctx, in); return }); err != nil {
			return nil, nil, err
		}
		return &sdk.CallToolResult{Content: []sdk.Content{&sdk.TextContent{Text: out}}}, nil, nil
	})
}

type startRunIn struct {
	Name         string   `json:"name" jsonschema:"short name of this QA run, e.g. 'checkout flow'"`
	BaseURL      string   `json:"base_url" jsonschema:"URL of the app under test; must match allowed_hosts"`
	AllowedHosts []string `json:"allowed_hosts" jsonschema:"hosts the browser may reach: 'host', 'host:port' or '*.example.com'. List only the app under test; everything else is blocked"`
	Context      string   `json:"context,omitempty" jsonschema:"business rules, user story or other context for this run"`
	Headed       bool     `json:"headed,omitempty" jsonschema:"show the browser window (default false)"`
}

type startRunOut struct {
	RunID  string           `json:"run_id"`
	RunDir string           `json:"run_dir"`
	Page   browser.PageInfo `json:"page"`
}

type endRunIn struct {
	Summary string `json:"summary" jsonschema:"overall assessment: what was covered, what failed, residual risk"`
}

type endRunOut struct {
	RunID     string `json:"run_id"`
	RunDir    string `json:"run_dir"`
	Cases     int    `json:"cases"`
	Bugs      int    `json:"bugs"`
	Dashboard string `json:"dashboard"`
}

func (s *Server) registerRunTools(m *sdk.Server) {
	addTool(s, m, "start_run", "Start a QA run: creates the run directory, launches Chromium restricted to allowed_hosts and opens base_url. Only one run can be active at a time.",
		func(_ context.Context, in startRunIn) (startRunOut, error) {
			if s.run != nil {
				return startRunOut{}, fmt.Errorf("run %s is still active: call end_run first", s.run.ID)
			}
			guard, err := browser.NewGuard(in.AllowedHosts)
			if err != nil {
				return startRunOut{}, err
			}
			if !guard.AllowsURL(in.BaseURL) {
				return startRunOut{}, fmt.Errorf("base_url %q is not covered by allowed_hosts %v", in.BaseURL, in.AllowedHosts)
			}
			run, err := s.store.Create(in.Name, in.BaseURL, in.AllowedHosts, in.Context, s.now())
			if err != nil {
				return startRunOut{}, err
			}
			dir := s.store.RunDir(run.ID)
			sess, err := browser.Launch(browser.Options{Hosts: in.AllowedHosts, Headed: in.Headed, ArtifactDir: dir, UploadRoot: s.uploadRoot})
			if err != nil {
				os.RemoveAll(dir)
				return startRunOut{}, err
			}
			page, err := sess.Navigate(in.BaseURL, 0)
			if err != nil {
				sess.Close()
				os.RemoveAll(dir)
				return startRunOut{}, fmt.Errorf("could not open base_url: %w", err)
			}
			s.run, s.sess = run, sess
			return startRunOut{RunID: run.ID, RunDir: dir, Page: page}, nil
		})

	addTool(s, m, "end_run", "Finish the active run: closes the browser and marks the run completed with your summary.",
		func(_ context.Context, in endRunIn) (endRunOut, error) {
			run, _, err := s.active()
			if err != nil {
				return endRunOut{}, err
			}
			out := endRunOut{
				RunID: run.ID, RunDir: s.store.RunDir(run.ID), Cases: len(run.Cases), Bugs: len(run.Bugs),
				Dashboard: "run `qa-engineer serve` in this project and open http://127.0.0.1:7777/runs/" + run.ID,
			}
			return out, s.finish(report.StatusCompleted, strings.TrimSpace(in.Summary))
		})
}
