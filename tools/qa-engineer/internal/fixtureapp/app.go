// Package fixtureapp is a tiny login app with deliberately planted bugs, used
// as a target to exercise the QA tools. Do NOT fix these bugs:
//
//  1. Emails are matched exactly: a different letter case or surrounding
//     whitespace is rejected.
//  2. Submitting an empty email or password returns a raw 500
//     "Internal Server Error" text page instead of a validation message.
//  3. A promo banner is 900px wide, so the page overflows horizontally on
//     mobile.
//  4. The logo image has no alt text.
package fixtureapp

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"sync"
)

// Credentials of the only valid account.
const (
	Email    = "qa@example.com"
	Password = "Secret123!"
)

const loginPage = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Acme Login</title>
</head>
<body>
<div class="promo" style="width:900px">Big sale: 50% off everything this week only!</div>
<img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Crect width='32' height='32' fill='%23336'/%3E%3C/svg%3E">
<h1>Sign in</h1>
<form id="login">
<label for="email">Email</label><input id="email" type="text">
<label for="password">Password</label><input id="password" type="password">
<button type="submit">Sign in</button>
<p id="msg" role="alert"></p>
</form>
<script>
document.getElementById('login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('msg');
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({email: document.getElementById('email').value, password: document.getElementById('password').value})
  });
  if (res.ok) { location.href = '/dashboard'; return; }
  const text = await res.text();
  try { msg.textContent = JSON.parse(text).error; } catch { msg.textContent = text; }
});
</script>
</body>
</html>`

const dashboardPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Dashboard</title></head>
<body><h1>Welcome back</h1><a href="/logout">Log out</a></body></html>`

const consoleErrorPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Console error</title></head>
<body><h1>Widgets</h1>
<script>
console.error("fixture: failed to load widgets");
throw new Error("fixture: boom");
</script></body></html>`

// uploadScript posts each file chosen in an input to /api/uploads.
const uploadScript = `<script>
document.querySelectorAll('input[type=file]').forEach(inp => inp.addEventListener('change', async () => {
  const fd = new FormData();
  for (const f of inp.files) fd.append('file', f);
  await fetch('/api/uploads', {method: 'POST', body: fd});
  document.getElementById('status').textContent = 'Sent ' + inp.files.length;
}));
</script>`

const uploadPlainPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Upload</title></head>
<body><h1>Upload</h1>
<input type="file" multiple aria-label="Plain upload">
<p id="status" role="status"></p>` + uploadScript + `</body></html>`

const uploadButtonPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Upload</title></head>
<body><h1>Upload</h1>
<button type="button" onclick="document.getElementById('hidden').click()">Attach</button>
<input id="hidden" type="file" multiple hidden>
<p id="status" role="status"></p>` + uploadScript + `</body></html>`

const framePage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Policy viewer</title></head>
<body><h1>Policy</h1><iframe src="/frame-inner" title="Policy document" width="400" height="200"></iframe></body></html>`

const frameInnerPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Inner</title></head>
<body><p>Terms of the policy.</p>
<button onclick="document.getElementById('r').textContent='Policy accepted'">Accept policy</button>
<p id="r"></p></body></html>`

// storedUpload is a file the app received; see GET /api/uploads.
type storedUpload struct {
	Name    string `json:"Name"`
	Type    string `json:"Type"`
	Content string `json:"Content"`
}

type app struct {
	mu       sync.Mutex
	sessions map[string]bool
	uploads  []storedUpload
}

// Handler returns a fresh app instance; sessions are per call.
func Handler() http.Handler {
	a := &app{sessions: map[string]bool{}}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) { html(w, loginPage) })
	mux.HandleFunc("POST /api/login", a.login)
	mux.HandleFunc("GET /dashboard", a.dashboard)
	mux.HandleFunc("GET /logout", a.logout)
	mux.HandleFunc("GET /go", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, r.URL.Query().Get("to"), http.StatusFound)
	})
	mux.HandleFunc("GET /console-error", func(w http.ResponseWriter, r *http.Request) { html(w, consoleErrorPage) })
	mux.HandleFunc("GET /upload-plain", func(w http.ResponseWriter, r *http.Request) { html(w, uploadPlainPage) })
	mux.HandleFunc("GET /upload-button", func(w http.ResponseWriter, r *http.Request) { html(w, uploadButtonPage) })
	mux.HandleFunc("GET /frame", func(w http.ResponseWriter, r *http.Request) { html(w, framePage) })
	mux.HandleFunc("GET /frame-inner", func(w http.ResponseWriter, r *http.Request) { html(w, frameInnerPage) })
	mux.HandleFunc("POST /api/uploads", a.upload)
	mux.HandleFunc("GET /api/uploads", func(w http.ResponseWriter, r *http.Request) {
		a.mu.Lock()
		defer a.mu.Unlock()
		out := a.uploads
		if out == nil {
			out = []storedUpload{}
		}
		jsonReply(w, http.StatusOK, out)
	})
	return mux
}

func (a *app) upload(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		jsonReply(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	for _, fh := range r.MultipartForm.File["file"] {
		f, err := fh.Open()
		if err != nil {
			continue
		}
		b, _ := io.ReadAll(f)
		f.Close()
		a.mu.Lock()
		a.uploads = append(a.uploads, storedUpload{fh.Filename, fh.Header.Get("Content-Type"), string(b)})
		a.mu.Unlock()
	}
	jsonReply(w, http.StatusOK, map[string]bool{"ok": true})
}

func html(w http.ResponseWriter, body string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(body))
}

func jsonReply(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func (a *app) login(w http.ResponseWriter, r *http.Request) {
	var in struct{ Email, Password string }
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonReply(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	if in.Email == "" || in.Password == "" {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	if in.Email != Email || in.Password != Password {
		jsonReply(w, http.StatusUnauthorized, map[string]string{"error": "Invalid email or password"})
		return
	}
	buf := make([]byte, 16)
	rand.Read(buf)
	token := hex.EncodeToString(buf)
	a.mu.Lock()
	a.sessions[token] = true
	a.mu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: "session", Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode})
	jsonReply(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *app) token(r *http.Request) (string, bool) {
	c, err := r.Cookie("session")
	if err != nil {
		return "", false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	return c.Value, a.sessions[c.Value]
}

func (a *app) dashboard(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.token(r); !ok {
		http.Redirect(w, r, "/", http.StatusFound)
		return
	}
	html(w, dashboardPage)
}

func (a *app) logout(w http.ResponseWriter, r *http.Request) {
	if tok, ok := a.token(r); ok {
		a.mu.Lock()
		delete(a.sessions, tok)
		a.mu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{Name: "session", Value: "", Path: "/", MaxAge: -1, HttpOnly: true})
	http.Redirect(w, r, "/", http.StatusFound)
}
