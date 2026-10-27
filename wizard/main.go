// forge: Bubbletea frontend for ./setup. It only drives `setup --list --porcelain`
// and `setup --only ...`; all install logic stays in bash.
package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	tea "github.com/charmbracelet/bubbletea"
)

func repoDir() string {
	if r := os.Getenv("FORGE_REPO"); r != "" {
		return r
	}
	if exe, err := os.Executable(); err == nil {
		// <repo>/wizard/bin/forge
		if r := filepath.Dir(filepath.Dir(filepath.Dir(exe))); fileExists(filepath.Join(r, "setup")) {
			return r
		}
	}
	return "."
}

func fileExists(p string) bool { _, err := os.Stat(p); return err == nil }

func main() {
	dry := false
	for _, a := range os.Args[1:] {
		switch a {
		case "--dry-run":
			dry = true
		case "-h", "--help":
			fmt.Println("Usage: forge [--dry-run]   (run via ./setup; FORGE_REPO points at the repo)")
			return
		default:
			fmt.Fprintln(os.Stderr, "unknown argument:", a)
			os.Exit(2)
		}
	}
	repo := repoDir()
	mods, err := loadModules(repo)
	if err != nil {
		fmt.Fprintln(os.Stderr, "forge:", err)
		os.Exit(1)
	}
	ctx, cancel := context.WithCancel(context.Background())
	final, err := tea.NewProgram(newModel(mods, execRunner(ctx, repo), dry), tea.WithAltScreen()).Run()
	cancel()
	if err != nil {
		fmt.Fprintln(os.Stderr, "forge:", err)
		os.Exit(1)
	}
	os.Exit(final.(model).exitCode)
}
