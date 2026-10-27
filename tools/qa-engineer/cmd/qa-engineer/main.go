// Command qa-engineer runs the QA MCP server, the reports dashboard and helpers.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
	playwright "github.com/mxschmitt/playwright-go"

	"qa-engineer/internal/fixtureapp"
	"qa-engineer/internal/mcp"
	"qa-engineer/internal/report"
	"qa-engineer/internal/web"
)

const usage = `usage: qa-engineer <command> [flags]

commands:
  mcp       run the MCP server on stdio (used by Claude Code)
  serve     serve the reports dashboard (default http://127.0.0.1:7777)
  install   download the Playwright driver and Chromium
  fixture   serve the demo app with planted bugs (default http://127.0.0.1:3999)
`

func main() {
	if len(os.Args) < 2 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	args := os.Args[2:]
	var err error
	switch os.Args[1] {
	case "mcp":
		err = runMCP(args)
	case "serve":
		err = runServe(args)
	case "install":
		err = playwright.Install(&playwright.RunOptions{Browsers: []string{"chromium"}})
	case "fixture":
		err = runFixture(args)
	default:
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "qa-engineer: %v\n", err)
		os.Exit(1)
	}
}

func runMCP(args []string) error {
	fs := flag.NewFlagSet("mcp", flag.ExitOnError)
	dir := fs.String("dir", "qa-reports", "reports directory")
	_ = fs.Parse(args)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	srv := mcp.New(report.Store{Dir: *dir})
	runErr := srv.MCP().Run(ctx, &sdk.StdioTransport{})
	return errors.Join(runErr, srv.Shutdown())
}

func runServe(args []string) error {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	port := fs.Int("port", 7777, "listen port")
	dir := fs.String("dir", "qa-reports", "reports directory")
	_ = fs.Parse(args)
	return listen(*port, "dashboard", web.LocalOnly(web.Handler(report.Store{Dir: *dir}, web.Assets())), "")
}

func runFixture(args []string) error {
	fs := flag.NewFlagSet("fixture", flag.ExitOnError)
	port := fs.Int("port", 3999, "listen port")
	_ = fs.Parse(args)
	login := fmt.Sprintf("demo login: %s / %s", fixtureapp.Email, fixtureapp.Password)
	return listen(*port, "fixture", fixtureapp.Handler(), login)
}

// listen serves h on 127.0.0.1:port, logging the URL (and extra) to stderr.
func listen(port int, label string, h http.Handler, extra string) error {
	ln, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	if err != nil {
		return err
	}
	logger := log.New(os.Stderr, "", 0)
	logger.Printf("%s: http://%s", label, ln.Addr())
	if extra != "" {
		logger.Print(extra)
	}
	srv := &http.Server{Handler: h, ReadHeaderTimeout: 10 * time.Second}
	return srv.Serve(ln)
}
