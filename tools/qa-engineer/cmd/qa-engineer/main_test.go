package main

import (
	"bytes"
	"context"
	"errors"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

func build(t *testing.T) string {
	t.Helper()
	bin := filepath.Join(t.TempDir(), "qa-engineer")
	if out, err := exec.Command("go", "build", "-o", bin, ".").CombinedOutput(); err != nil {
		t.Fatalf("build: %v\n%s", err, out)
	}
	return bin
}

func TestMCPStdioListsTools(t *testing.T) {
	bin := build(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	client := sdk.NewClient(&sdk.Implementation{Name: "test", Version: "0"}, nil)
	session, err := client.Connect(ctx, &sdk.CommandTransport{Command: exec.Command(bin, "mcp", "--dir", t.TempDir())}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	res, err := session.ListTools(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Tools) != 20 {
		t.Errorf("got %d tools, want 20", len(res.Tools))
	}
}

func TestUsage(t *testing.T) {
	bin := build(t)
	var stderr bytes.Buffer
	cmd := exec.Command(bin, "bogus")
	cmd.Stderr = &stderr
	err := cmd.Run()
	var exit *exec.ExitError
	if !errors.As(err, &exit) || exit.ExitCode() != 2 {
		t.Fatalf("err = %v, want exit code 2", err)
	}
	if !bytes.Contains(stderr.Bytes(), []byte("usage:")) {
		t.Errorf("stderr %q missing usage:", stderr.String())
	}
}
