package main

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

func testMods() []Module {
	return []Module{
		{Name: "base", Status: "installed", Desc: "base tools", Default: true, Selected: true},
		{Name: "skills", Status: "missing", Desc: "link skills", Deps: []string{"base"}},
		{Name: "extra", Status: "missing", Desc: "extra stuff", Deps: []string{"skills"}},
	}
}

func fakeRunner(msgs ...tea.Msg) runner {
	return func([]string, bool) <-chan tea.Msg {
		ch := make(chan tea.Msg, len(msgs))
		for _, m := range msgs {
			ch <- m
		}
		close(ch)
		return ch
	}
}

func key(m model, s string) model {
	var k tea.KeyMsg
	switch s {
	case "enter":
		k = tea.KeyMsg{Type: tea.KeyEnter}
	case "esc":
		k = tea.KeyMsg{Type: tea.KeyEsc}
	case "up":
		k = tea.KeyMsg{Type: tea.KeyUp}
	case "down":
		k = tea.KeyMsg{Type: tea.KeyDown}
	case " ":
		k = tea.KeyMsg{Type: tea.KeySpace}
	default:
		k = tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(s)}
	}
	nm, _ := m.Update(k)
	return nm.(model)
}

func picker(t *testing.T, r runner, dry bool) model {
	m := newModel(testMods(), r, dry)
	m = key(m, "enter") // welcome -> picker
	if m.screen != pick {
		t.Fatalf("screen %v", m.screen)
	}
	return m
}

func TestWelcomeQuit(t *testing.T) {
	m := newModel(testMods(), nil, false)
	if !strings.Contains(m.View(), "Forge") {
		t.Fatal("no title")
	}
	_, cmd := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("q")})
	if cmd == nil {
		t.Fatal("q should quit")
	}
}

func TestSelectingAddsDepsAndDeselectCascades(t *testing.T) {
	m := picker(t, nil, false)
	m = key(m, "n") // none
	m = key(m, "down")
	m = key(m, "down") // extra
	m = key(m, " ")
	for _, n := range []string{"base", "skills", "extra"} {
		if !m.sel[n] {
			t.Fatalf("%s not selected: %v", n, m.sel)
		}
	}
	if !strings.Contains(m.notice, "base") || !strings.Contains(m.notice, "skills") {
		t.Fatalf("notice %q", m.notice)
	}
	m = key(m, "up") // skills
	m = key(m, " ")  // deselect skills -> extra goes too, base stays
	if m.sel["skills"] || m.sel["extra"] || !m.sel["base"] {
		t.Fatalf("cascade: %v", m.sel)
	}
}

func TestPickerKeysAndView(t *testing.T) {
	m := picker(t, nil, false)
	if !m.sel["base"] || m.sel["skills"] {
		t.Fatalf("initial %v", m.sel)
	}
	m = key(m, "a")
	if len(m.sel) != 3 {
		t.Fatalf("all: %v", m.sel)
	}
	m = key(m, "j")
	m = key(m, "j")
	m = key(m, "k")
	if m.cursor != 1 {
		t.Fatalf("cursor %d", m.cursor)
	}
	v := m.View()
	for _, s := range []string{"base", "installed", "missing", "link skills", "needs"} {
		if !strings.Contains(v, s) {
			t.Errorf("view lacks %q", s)
		}
	}
	m = key(m, "n")
	m = key(m, "enter")
	if m.screen != pick || m.notice == "" {
		t.Fatal("empty selection must not continue")
	}
}

func TestReviewBackAndDryRun(t *testing.T) {
	m := picker(t, nil, true)
	m = key(m, "enter")
	if m.screen != review {
		t.Fatalf("screen %v", m.screen)
	}
	if v := m.View(); !strings.Contains(v, "dry run") || !strings.Contains(v, "base") {
		t.Fatalf("review view:\n%s", v)
	}
	m = key(m, "esc")
	if m.screen != pick {
		t.Fatal("esc should go back")
	}
}

func TestInstallFlowToSummary(t *testing.T) {
	r := fakeRunner(
		eventMsg{Kind: "start", Name: "base"}, lineMsg("hello"), eventMsg{Kind: "result", Name: "base", Result: "ok"},
		eventMsg{Kind: "result", Name: "skills", Result: "failed", Note: "exit 2"},
		lineMsg(""), lineMsg("Manual follow-ups:"), lineMsg(" - run foo"), lineMsg(" - run bar"),
		doneMsg{Code: 1},
	)
	m := picker(t, r, false)
	m = key(m, "down")
	m = key(m, " ") // skills (base already on)
	m = key(m, "enter")
	nm, cmd := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = nm.(model)
	if m.screen != progress || cmd == nil {
		t.Fatalf("screen %v", m.screen)
	}
	if !strings.Contains(m.View(), "base") {
		t.Fatal("progress view")
	}
	for m.screen == progress {
		msg := m.ch
		got, ok := <-msg
		if !ok {
			t.Fatal("channel closed before done")
		}
		nm, _ := m.Update(got)
		m = nm.(model)
	}
	if m.exitCode != 1 {
		t.Fatalf("exit %d", m.exitCode)
	}
	v := m.View()
	for _, s := range []string{"1 ok", "1 failed", "exit 2", "Manual follow-ups", "run foo", "run bar"} {
		if !strings.Contains(v, s) {
			t.Errorf("summary lacks %q:\n%s", s, v)
		}
	}
	if _, cmd := m.Update(tea.KeyMsg{Type: tea.KeyEnter}); cmd == nil {
		t.Fatal("enter should quit from summary")
	}
}

func TestDoneMarksUnfinishedModules(t *testing.T) {
	m := picker(t, fakeRunner(eventMsg{Kind: "start", Name: "base"}, doneMsg{Code: 1}), false)
	m = key(m, "enter")
	m = key(m, "enter")
	for m.screen == progress {
		nm, _ := m.Update(<-m.ch)
		m = nm.(model)
	}
	if m.state["base"] != "failed" {
		t.Fatalf("state %v", m.state)
	}
}
