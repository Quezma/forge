package main

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestParsePorcelain(t *testing.T) {
	out := "prereq\tinstalled\ton\t1\t\tbase tools\nskills\tmissing\toff\t0\tprereq mcp\tlink skills\nbroken line\n"
	got := parsePorcelain(out)
	want := []Module{
		{Name: "prereq", Status: "installed", Desc: "base tools", Default: true, Selected: true, Deps: []string{}},
		{Name: "skills", Status: "missing", Desc: "link skills", Deps: []string{"prereq", "mcp"}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v want %+v", got, want)
	}
}

func TestParseEvent(t *testing.T) {
	cases := map[string]struct {
		e  Event
		ok bool
	}{
		"@@forge start mcp":                {Event{Kind: "start", Name: "mcp"}, true},
		"@@forge result mcp ok":            {Event{Kind: "result", Name: "mcp", Result: "ok"}, true},
		"@@forge result mcp failed exit 1": {Event{Kind: "result", Name: "mcp", Result: "failed", Note: "exit 1"}, true},
		"@@forge result mcp":               {Event{}, false},
		"==> mcp":                          {Event{}, false},
	}
	for in, c := range cases {
		e, ok := parseEvent(in)
		if ok != c.ok || (ok && e != c.e) {
			t.Errorf("%q: got %+v %v", in, e, ok)
		}
	}
}

func TestExecRunnerStreamsEvents(t *testing.T) {
	repo := t.TempDir()
	script := "#!/bin/sh\necho @@forge start a\necho hello >&2\necho @@forge result a failed exit 3\nexit 3\n"
	if err := os.WriteFile(filepath.Join(repo, "setup"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	var msgs []any
	for m := range execRunner(context.Background(), repo)([]string{"a"}, false) {
		msgs = append(msgs, m)
	}
	want := []any{eventMsg{Kind: "start", Name: "a"}, lineMsg("hello"), eventMsg{Kind: "result", Name: "a", Result: "failed", Note: "exit 3"}}
	if len(msgs) != 4 || !reflect.DeepEqual(msgs[:3], want) {
		t.Fatalf("got %+v", msgs)
	}
	if d, ok := msgs[3].(doneMsg); !ok || d.Code != 3 {
		t.Fatalf("done: %+v", msgs[3])
	}
}
