package browser

import (
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"strings"
	"time"
)

// GuardHeader is set to "blocked" on responses the proxy refuses.
const GuardHeader = "X-Qa-Guard"

// Proxy is a local forward proxy that only lets allowlisted hosts through.
// The browser runs behind it so redirect hops and IP literals are checked too.
type Proxy struct {
	g   *Guard
	ln  net.Listener
	srv *http.Server
	rp  *httputil.ReverseProxy
}

// StartProxy listens on 127.0.0.1 on a random port and serves until Close.
func StartProxy(g *Guard) (*Proxy, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.Proxy = nil
	p := &Proxy{g: g, ln: ln}
	// The incoming request URL is already absolute, so Rewrite has nothing to do.
	p.rp = &httputil.ReverseProxy{Rewrite: func(*httputil.ProxyRequest) {}, Transport: tr}
	p.srv = &http.Server{Handler: p, ReadHeaderTimeout: 30 * time.Second}
	go p.srv.Serve(ln)
	return p, nil
}

// URL returns the proxy address, e.g. http://127.0.0.1:54321.
func (p *Proxy) URL() string { return "http://" + p.ln.Addr().String() }

// Close stops the proxy and drops open connections.
func (p *Proxy) Close() error { return p.srv.Close() }

// ServeHTTP enforces the allowlist, then tunnels CONNECT or forwards plain HTTP.
func (p *Proxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	target := r.URL.Host
	if target == "" {
		target = r.Host
	}
	host, port, err := net.SplitHostPort(target)
	if err != nil {
		host, port = strings.Trim(target, "[]"), "80"
		if r.URL.Scheme == "https" {
			port = "443"
		}
		target = net.JoinHostPort(host, port)
	}
	if !p.g.AllowsHostPort(host, port) {
		w.Header().Set(GuardHeader, "blocked")
		http.Error(w, "blocked by qa-engineer: host not in allowed_hosts", http.StatusForbidden)
		return
	}
	if r.Method == http.MethodConnect {
		tunnel(w, target)
		return
	}
	if !r.URL.IsAbs() {
		http.Error(w, "proxy requests must use absolute URLs", http.StatusBadRequest)
		return
	}
	p.rp.ServeHTTP(w, r)
}

func tunnel(w http.ResponseWriter, target string) {
	up, err := net.DialTimeout("tcp", target, 10*time.Second)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	hj, ok := w.(http.Hijacker)
	if !ok {
		up.Close()
		http.Error(w, "hijack unsupported", http.StatusInternalServerError)
		return
	}
	client, buf, err := hj.Hijack()
	if err != nil {
		up.Close()
		return
	}
	client.Write([]byte("HTTP/1.1 200 Connection Established\r\n\r\n"))
	go func() {
		io.Copy(up, buf) // buffered reader keeps bytes already read from the client
		up.Close()
		client.Close()
	}()
	go func() {
		io.Copy(client, up)
		client.Close()
		up.Close()
	}()
}
