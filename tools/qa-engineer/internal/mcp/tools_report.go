package mcp

import (
	"context"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"qa-engineer/internal/report"
)

type recordCaseIn struct {
	Name     string `json:"name" jsonschema:"what was checked, e.g. 'login with uppercase email'"`
	Category string `json:"category" jsonschema:"one of: functional, business, ui, security, a11y, performance"`
	Status   string `json:"status" jsonschema:"one of: pass, fail, blocked (could not be tested)"`
	Notes    string `json:"notes,omitempty" jsonschema:"what you observed, inputs used, why blocked"`
}

type reportBugIn struct {
	Title    string   `json:"title" jsonschema:"one-line summary of the defect"`
	Severity string   `json:"severity" jsonschema:"one of: critical (data loss or flow unusable), high (major feature broken), medium (wrong behaviour with a workaround), low (cosmetic or minor)"`
	Category string   `json:"category" jsonschema:"one of: functional, business, ui, security, a11y, performance"`
	Steps    []string `json:"steps" jsonschema:"exact steps to reproduce, one action per entry"`
	Expected string   `json:"expected" jsonschema:"what should have happened"`
	Actual   string   `json:"actual" jsonschema:"what happened instead"`
	Evidence []string `json:"evidence,omitempty" jsonschema:"screenshot paths as returned by the screenshot tool"`
}

func (s *Server) registerReportTools(m *sdk.Server) {
	addTool(s, m, "record_case", "Record one check you performed, whatever the outcome. Saved to the run report immediately.",
		func(_ context.Context, in recordCaseIn) (report.Case, error) {
			run, _, err := s.active()
			if err != nil {
				return report.Case{}, err
			}
			c, err := run.AddCase(report.Case{Name: in.Name, Category: in.Category, Status: in.Status, Notes: in.Notes}, s.now())
			if err != nil {
				return report.Case{}, err
			}
			return c, s.store.Save(run)
		})

	addTool(s, m, "report_bug", "Report a defect with reproduction steps and evidence. Saved to the run report immediately.",
		func(_ context.Context, in reportBugIn) (report.Bug, error) {
			run, _, err := s.active()
			if err != nil {
				return report.Bug{}, err
			}
			b, err := run.AddBug(report.Bug{
				Title: in.Title, Severity: in.Severity, Category: in.Category, Steps: in.Steps,
				Expected: in.Expected, Actual: in.Actual, Evidence: in.Evidence,
			}, s.store.RunDir(run.ID), s.now())
			if err != nil {
				return report.Bug{}, err
			}
			return b, s.store.Save(run)
		})
}
