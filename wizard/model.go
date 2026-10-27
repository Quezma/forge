package main

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

type screen int

const (
	welcome screen = iota
	pick
	review
	progress
	summary
)

const tailLines = 6

var (
	accent = lipgloss.AdaptiveColor{Light: "#5B3FD0", Dark: "#A78BFA"}
	dim    = lipgloss.AdaptiveColor{Light: "#6B6B6B", Dark: "#8A8A8A"}
	good   = lipgloss.AdaptiveColor{Light: "#1A7F37", Dark: "#4ADE80"}
	bad    = lipgloss.AdaptiveColor{Light: "#C62828", Dark: "#F87171"}
	warnC  = lipgloss.AdaptiveColor{Light: "#9A6700", Dark: "#FBBF24"}

	sAccent = lipgloss.NewStyle().Foreground(accent).Bold(true)
	sDim    = lipgloss.NewStyle().Foreground(dim)
	sGood   = lipgloss.NewStyle().Foreground(good)
	sBad    = lipgloss.NewStyle().Foreground(bad)
	sWarn   = lipgloss.NewStyle().Foreground(warnC)
	sBadge  = lipgloss.NewStyle().Foreground(warnC).Bold(true)
)

const logo = `┏━╸┏━┓┏━┓┏━╸┏━╸
┣╸ ┃ ┃┣┳┛┃╺┓┣╸
╹  ┗━┛╹┗╸┗━┛┗━╸`

type model struct {
	screen   screen
	mods     []Module
	sel      map[string]bool
	cursor   int
	notice   string
	dry      bool
	run      runner
	ch       <-chan tea.Msg
	state    map[string]string // pending|running|ok|failed|skipped
	notes    map[string]string
	tail     []string
	follow   []string
	inFollow bool
	exitCode int
	w, h     int
	sp       spinner.Model
}

func newModel(mods []Module, run runner, dry bool) model {
	m := model{mods: mods, run: run, dry: dry, sel: map[string]bool{}, state: map[string]string{}, notes: map[string]string{}, w: 80, h: 24}
	for _, md := range mods {
		if md.Selected {
			m.sel[md.Name] = true
		}
	}
	for _, md := range mods {
		if m.sel[md.Name] {
			m.addDeps(md)
		}
	}
	m.sp = spinner.New(spinner.WithSpinner(spinner.Dot), spinner.WithStyle(sAccent))
	return m
}

func (m model) mod(name string) (Module, bool) {
	for _, md := range m.mods {
		if md.Name == name {
			return md, true
		}
	}
	return Module{}, false
}

// addDeps selects every transitive dependency of md and returns the names it added.
func (m model) addDeps(md Module) (added []string) {
	for _, d := range md.Deps {
		if dm, ok := m.mod(d); ok {
			if !m.sel[d] {
				m.sel[d] = true
				added = append(added, d)
			}
			added = append(added, m.addDeps(dm)...)
		}
	}
	return
}

// prune deselects modules whose dependencies are no longer selected (cascade on deselect).
func (m model) prune() (removed []string) {
	for changed := true; changed; {
		changed = false
		for _, md := range m.mods {
			for _, d := range md.Deps {
				if m.sel[md.Name] && !m.sel[d] {
					delete(m.sel, md.Name)
					removed = append(removed, md.Name)
					changed = true
					break
				}
			}
		}
	}
	return
}

func (m model) chosen() (names []string) {
	for _, md := range m.mods {
		if m.sel[md.Name] {
			names = append(names, md.Name)
		}
	}
	return
}

func (m model) toggle() model {
	md := m.mods[m.cursor]
	m.notice = ""
	if m.sel[md.Name] {
		delete(m.sel, md.Name)
		if r := m.prune(); len(r) > 0 {
			m.notice = "also deselected (needs " + md.Name + "): " + strings.Join(r, ", ")
		}
		return m
	}
	m.sel[md.Name] = true
	if a := m.addDeps(md); len(a) > 0 {
		m.notice = "also selected (needed): " + strings.Join(a, ", ")
	}
	return m
}

func (m model) Init() tea.Cmd { return nil }

func waitMsg(ch <-chan tea.Msg) tea.Cmd {
	return func() tea.Msg {
		if msg, ok := <-ch; ok {
			return msg
		}
		return nil
	}
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.w, m.h = msg.Width, msg.Height
	case spinner.TickMsg:
		var cmd tea.Cmd
		m.sp, cmd = m.sp.Update(msg)
		return m, cmd
	case tea.KeyMsg:
		return m.key(msg.String())
	case eventMsg:
		if msg.Kind == "start" {
			m.state[msg.Name] = "running"
		} else {
			m.state[msg.Name], m.notes[msg.Name] = msg.Result, msg.Note
		}
		return m, waitMsg(m.ch)
	case lineMsg:
		l := string(msg)
		switch {
		case strings.HasPrefix(l, "Manual follow-ups:"):
			m.inFollow = true
		case m.inFollow:
			if t := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(l), "- ")); t != "" {
				m.follow = append(m.follow, t)
			}
		}
		if l = strings.TrimSpace(l); l != "" {
			m.tail = append(m.tail, l)
			if len(m.tail) > tailLines {
				m.tail = m.tail[1:]
			}
		}
		return m, waitMsg(m.ch)
	case doneMsg:
		m.exitCode = msg.Code
		for _, n := range m.chosen() {
			switch m.state[n] {
			case "running":
				m.state[n], m.notes[n] = "failed", "interrupted"
			case "pending":
				m.state[n], m.notes[n] = "skipped", "not run"
			}
		}
		m.screen = summary
	}
	return m, nil
}

func (m model) key(k string) (tea.Model, tea.Cmd) {
	if k == "ctrl+c" {
		m.exitCode = 130
		return m, tea.Quit
	}
	switch m.screen {
	case welcome:
		switch k {
		case "enter":
			m.screen = pick
		case "q", "esc":
			return m, tea.Quit
		}
	case pick:
		switch k {
		case "up", "k":
			if m.cursor > 0 {
				m.cursor--
			}
		case "down", "j":
			if m.cursor < len(m.mods)-1 {
				m.cursor++
			}
		case " ":
			m = m.toggle()
		case "a":
			for _, md := range m.mods {
				m.sel[md.Name] = true
			}
			m.notice = ""
		case "n":
			m.sel = map[string]bool{}
			m.notice = ""
		case "enter":
			if len(m.sel) == 0 {
				m.notice = "select at least one module"
			} else {
				m.notice, m.screen = "", review
			}
		case "q", "esc":
			return m, tea.Quit
		}
	case review:
		switch k {
		case "esc", "b":
			m.screen = pick
		case "q":
			return m, tea.Quit
		case "enter":
			m.screen = progress
			for _, n := range m.chosen() {
				m.state[n] = "pending"
			}
			m.ch = m.run(m.chosen(), m.dry)
			return m, tea.Batch(waitMsg(m.ch), m.sp.Tick)
		}
	case summary:
		if k == "enter" || k == "q" || k == "esc" {
			return m, tea.Quit
		}
	}
	return m, nil
}

// --- views -------------------------------------------------------------------

func (m model) width() int { return max(40, min(m.w-4, 80)) }

func (m model) box(s string) string {
	return lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(accent).Padding(0, 1).Width(m.width()).Render(s)
}

func (m model) header(sub string) string {
	h := sAccent.Render("Forge") + sDim.Render(" · "+sub)
	if m.dry {
		h += " " + sBadge.Render("[dry run]")
	}
	return h
}

func help(s string) string { return sDim.Render(s) }

func (m model) View() string {
	var s string
	switch m.screen {
	case welcome:
		s = sAccent.Render(logo) + "\n\n" + sAccent.Render("Forge") + "\n" +
			"Set up Claude Code, skills, MCP servers and tools on this Mac.\n\n" + help("enter start · q quit")
	case pick:
		s = m.pickView()
	case review:
		s = m.header("review") + "\n\n"
		var rows []string
		for _, n := range m.chosen() {
			md, _ := m.mod(n)
			r := "  " + sGood.Render("•") + " " + fmt.Sprintf("%-14s", n) + sDim.Render(md.Status)
			if len(md.Deps) > 0 {
				r += sDim.Render("  needs " + strings.Join(md.Deps, ", "))
			}
			rows = append(rows, r)
		}
		s += m.box(strings.Join(rows, "\n")) + "\n"
		if m.dry {
			s += sBadge.Render("dry run") + sDim.Render(": commands are printed, nothing is changed") + "\n"
		}
		s += "\n" + help("enter install · esc back · q quit")
	case progress:
		s = m.header("installing") + "\n\n" + m.box(m.stateRows(true)) + "\n" + m.tailView()
	case summary:
		s = m.summaryView()
	}
	if m.w > 0 && m.h > 0 {
		s = lipgloss.NewStyle().Width(m.width() + 2).Render(s)
		return lipgloss.Place(m.w, m.h, lipgloss.Center, lipgloss.Center, s)
	}
	return s
}

func (m model) pickView() string {
	var rows []string
	for i, md := range m.mods {
		cur, box := "  ", "[ ]"
		if i == m.cursor {
			cur = sAccent.Render("› ")
		}
		if m.sel[md.Name] {
			box = sGood.Render("[x]")
		}
		def := " "
		if md.Default {
			def = sAccent.Render("★")
		}
		rows = append(rows, fmt.Sprintf("%s%s %-14s %s %s", cur, box, md.Name, badge(md.Status), def))
	}
	md := m.mods[m.cursor]
	detail := lipgloss.NewStyle().Width(m.width() - 4).Render(md.Desc)
	if len(md.Deps) > 0 {
		detail += "\n" + sDim.Render("needs: "+strings.Join(md.Deps, ", "))
	}
	detail += "\n" + sDim.Render(fmt.Sprintf("status: %s · default: %v", md.Status, map[bool]string{true: "on", false: "off"}[md.Default]))
	s := m.header("choose modules") + "\n\n" + m.box(strings.Join(rows, "\n")) + "\n" + m.box(detail) + "\n"
	if m.notice != "" {
		s += sWarn.Render(m.notice) + "\n"
	}
	return s + help("↑/↓ j/k move · space toggle · a all · n none · enter continue · q quit") + "\n" + sDim.Render("★ on by default")
}

func badge(status string) string {
	st := fmt.Sprintf("%-9s", status)
	switch status {
	case "installed":
		return sGood.Render(st)
	case "partial":
		return sWarn.Render(st)
	}
	return sDim.Render(st)
}

func (m model) stateRows(spin bool) string {
	var rows []string
	for _, n := range m.chosen() {
		var icon string
		switch m.state[n] {
		case "running":
			icon = m.sp.View()
		case "ok":
			icon = sGood.Render("✓")
		case "failed":
			icon = sBad.Render("✗")
		case "skipped":
			icon = sDim.Render("–")
		default:
			icon = sDim.Render("·")
		}
		r := icon + " " + n
		if note := m.notes[n]; note != "" {
			r += sDim.Render("  (" + note + ")")
		}
		rows = append(rows, r)
	}
	return strings.Join(rows, "\n")
}

func (m model) tailView() string {
	var b strings.Builder
	for _, l := range m.tail {
		if r := []rune(l); len(r) > m.width()-2 {
			l = string(r[:m.width()-3]) + "…"
		}
		b.WriteString(sDim.Render(l) + "\n")
	}
	return b.String()
}

func (m model) summaryView() string {
	c := map[string]int{}
	for _, n := range m.chosen() {
		c[m.state[n]]++
	}
	s := m.header("summary") + "\n\n" + fmt.Sprintf("%s · %s · %s",
		sGood.Render(fmt.Sprintf("%d ok", c["ok"])), sBad.Render(fmt.Sprintf("%d failed", c["failed"])), sDim.Render(fmt.Sprintf("%d skipped", c["skipped"]))) +
		"\n\n" + m.box(m.stateRows(false)) + "\n"
	if len(m.follow) > 0 {
		s += "\n" + sAccent.Render("Manual follow-ups") + "\n"
		for _, f := range m.follow {
			s += lipgloss.NewStyle().Width(m.width()).Render(" - "+f) + "\n"
		}
	}
	return s + "\n" + help("enter/q exit")
}
