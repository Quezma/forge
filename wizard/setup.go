package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
)

// Module is one line of `setup --list --porcelain`.
type Module struct {
	Name, Status, Desc string
	Default, Selected  bool
	Deps               []string
}

// Event is an `@@forge start|result` line emitted by `setup` when FORGE_EVENTS=1.
type Event struct{ Kind, Name, Result, Note string }

type (
	lineMsg  string
	eventMsg Event
	doneMsg  struct {
		Code int
		Err  error
	}
)

// runner starts `setup --only names` and streams its output; the channel closes after doneMsg.
type runner func(names []string, dry bool) <-chan tea.Msg

func parsePorcelain(out string) []Module {
	var mods []Module
	for _, l := range strings.Split(out, "\n") {
		f := strings.SplitN(l, "\t", 6)
		if len(f) < 6 {
			continue
		}
		mods = append(mods, Module{Name: f[0], Status: f[1], Default: f[2] == "on", Selected: f[3] == "1", Deps: strings.Fields(f[4]), Desc: f[5]})
	}
	return mods
}

func parseEvent(line string) (Event, bool) {
	f := strings.SplitN(line, " ", 5)
	if len(f) < 3 || f[0] != "@@forge" {
		return Event{}, false
	}
	e := Event{Kind: f[1], Name: f[2]}
	if e.Kind == "result" && len(f) >= 4 {
		e.Result = f[3]
		if len(f) == 5 {
			e.Note = f[4]
		}
	}
	return e, e.Kind == "start" || (e.Kind == "result" && e.Result != "")
}

func loadModules(repo string) ([]Module, error) {
	out, err := exec.Command(filepath.Join(repo, "setup"), "--list", "--porcelain").Output()
	if err != nil {
		return nil, fmt.Errorf("setup --list --porcelain: %w", err)
	}
	mods := parsePorcelain(string(out))
	if len(mods) == 0 {
		return nil, errors.New("setup listed no modules")
	}
	return mods, nil
}

func execRunner(ctx context.Context, repo string) runner {
	return func(names []string, dry bool) <-chan tea.Msg {
		ch := make(chan tea.Msg, 64)
		go func() {
			defer close(ch)
			args := []string{"--only", strings.Join(names, ",")}
			if dry {
				args = append(args, "--dry-run")
			}
			cmd := exec.CommandContext(ctx, filepath.Join(repo, "setup"), args...)
			cmd.Env = append(os.Environ(), "FORGE_EVENTS=1")
			pr, pw := io.Pipe()
			cmd.Stdout, cmd.Stderr = pw, pw
			if err := cmd.Start(); err != nil {
				ch <- doneMsg{1, err}
				return
			}
			waited := make(chan error, 1)
			go func() { waited <- cmd.Wait(); pw.Close() }()
			sc := bufio.NewScanner(pr)
			for sc.Scan() {
				l := strings.TrimRight(sc.Text(), "\r")
				if e, ok := parseEvent(l); ok {
					ch <- eventMsg(e)
				} else {
					ch <- lineMsg(l)
				}
			}
			err := <-waited
			code := 0
			var ee *exec.ExitError
			if errors.As(err, &ee) {
				code = ee.ExitCode()
			} else if err != nil {
				code = 1
			}
			ch <- doneMsg{code, err}
		}()
		return ch
	}
}
