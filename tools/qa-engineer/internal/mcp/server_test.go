package mcp

import (
	"context"
	"encoding/json"
	"sort"
	"strings"
	"testing"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"qa-engineer/internal/report"
)

func newTestServer(t *testing.T) (*Server, *sdk.ClientSession, report.Store) {
	t.Helper()
	store := report.Store{Dir: t.TempDir()}
	srv := New(store)
	ctx := context.Background()
	ct, st := sdk.NewInMemoryTransports()
	if _, err := srv.MCP().Connect(ctx, st, nil); err != nil {
		t.Fatal(err)
	}
	cs, err := sdk.NewClient(&sdk.Implementation{Name: "test", Version: "0"}, nil).Connect(ctx, ct, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { cs.Close() })
	return srv, cs, store
}

func call(t *testing.T, cs *sdk.ClientSession, name string, args map[string]any) *sdk.CallToolResult {
	t.Helper()
	res, err := cs.CallTool(context.Background(), &sdk.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		t.Fatalf("%s: protocol error: %v", name, err)
	}
	return res
}

func text(res *sdk.CallToolResult) string {
	var b strings.Builder
	for _, c := range res.Content {
		if tc, ok := c.(*sdk.TextContent); ok {
			b.WriteString(tc.Text)
		}
	}
	return b.String()
}

// callOK calls a tool, requires success and decodes structured output into out (if non-nil).
func callOK(t *testing.T, cs *sdk.ClientSession, name string, args map[string]any, out any) *sdk.CallToolResult {
	t.Helper()
	res := call(t, cs, name, args)
	if res.IsError {
		t.Fatalf("%s failed: %s", name, text(res))
	}
	if out != nil {
		decode(t, res, out)
	}
	return res
}

func decode(t *testing.T, res *sdk.CallToolResult, out any) {
	t.Helper()
	b, err := json.Marshal(res.StructuredContent)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, out); err != nil {
		t.Fatalf("decode %s: %v", b, err)
	}
}

// callErr calls a tool, requires a tool error and returns its text.
func callErr(t *testing.T, cs *sdk.ClientSession, name string, args map[string]any) string {
	t.Helper()
	res := call(t, cs, name, args)
	if !res.IsError {
		t.Fatalf("%s should have failed, got: %s", name, text(res))
	}
	return text(res)
}

func TestListTools(t *testing.T) {
	_, cs, _ := newTestServer(t)
	res, err := cs.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, tl := range res.Tools {
		got = append(got, tl.Name)
	}
	want := strings.Fields("start_run end_run navigate snapshot click fill press select hover screenshot console_logs network_log set_viewport new_context storage intercept a11y_audit upload_file record_case report_bug")
	sort.Strings(got)
	sort.Strings(want)
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("tools = %v, want %v", got, want)
	}
}

func TestToolsWithoutRunPointToStartRun(t *testing.T) {
	_, cs, _ := newTestServer(t)
	cases := map[string]map[string]any{
		"navigate":    {"url": "http://localhost:3000"},
		"snapshot":    {},
		"record_case": {"name": "x", "category": "functional", "status": "pass"},
		"end_run":     {"summary": "x"},
	}
	for name, args := range cases {
		if msg := callErr(t, cs, name, args); !strings.Contains(msg, "start_run") {
			t.Errorf("%s error %q should mention start_run", name, msg)
		}
	}
}

func TestStartRunRejectsBaseURLOutsideAllowedHosts(t *testing.T) {
	_, cs, store := newTestServer(t)
	msg := callErr(t, cs, "start_run", map[string]any{
		"name": "n", "base_url": "http://other.test/", "allowed_hosts": []string{"localhost:3000"},
	})
	if !strings.Contains(msg, "allowed_hosts") {
		t.Errorf("error %q should mention allowed_hosts", msg)
	}
	if l, _ := store.List(); len(l) != 0 {
		t.Errorf("no run should be created, got %v", l)
	}
}

func TestStartRunRequiresAllowedHosts(t *testing.T) {
	_, cs, _ := newTestServer(t)
	callErr(t, cs, "start_run", map[string]any{"name": "n", "base_url": "http://localhost:3000", "allowed_hosts": []string{}})
}

func TestMissingRequiredArgumentIsToolError(t *testing.T) {
	_, cs, _ := newTestServer(t)
	res, err := cs.CallTool(context.Background(), &sdk.CallToolParams{Name: "navigate", Arguments: map[string]any{}})
	if err == nil && !res.IsError {
		t.Fatal("expected an error for missing url")
	}
}
