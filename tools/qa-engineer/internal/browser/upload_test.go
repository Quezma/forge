package browser

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type received struct {
	Name, Type, Content string
}

func uploads(t *testing.T, base string) []received {
	t.Helper()
	res, err := http.Get(base + "/api/uploads")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var out []received
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestUploadPlainInputInline(t *testing.T) {
	s, base := launchFixture(t)
	if _, err := s.Navigate(base+"/upload-plain", 0); err != nil {
		t.Fatal(err)
	}
	ref := refFor(t, snap(t, s), "Plain upload")
	res, err := s.Upload(ref, []UploadFile{{Name: "a.svg", MimeType: "image/svg+xml", Content: "<svg><script>1</script></svg>"}}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if res.UsedChooser || len(res.Files) != 1 || res.Files[0].Name != "a.svg" || res.Files[0].Size != 29 {
		t.Fatalf("result = %+v", res)
	}
	eventually(t, "server to receive the file", func() bool { return len(uploads(t, base)) == 1 })
	if got := uploads(t, base)[0]; got != (received{"a.svg", "image/svg+xml", "<svg><script>1</script></svg>"}) {
		t.Fatalf("received %+v", got)
	}
}

func TestUploadButtonOpensChooserFromPathAndBase64(t *testing.T) {
	s, base := launchFixture(t)
	if _, err := s.Navigate(base+"/upload-button", 0); err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(s.uploadRoot(), "note.txt")
	os.WriteFile(p, []byte("hello"), 0o644)
	res, err := s.Upload(refFor(t, snap(t, s), `button "Attach"`), []UploadFile{{Path: p}, {Name: "b.bin", MimeType: "application/x-evil", ContentBase64: base64.StdEncoding.EncodeToString([]byte{0, 1, 2})}}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if !res.UsedChooser || len(res.Files) != 2 || res.Files[0].MimeType != "text/plain; charset=utf-8" {
		t.Fatalf("result = %+v", res)
	}
	eventually(t, "server to receive both files", func() bool { return len(uploads(t, base)) == 2 })
	got := uploads(t, base)
	if got[0] != (received{"note.txt", "text/plain; charset=utf-8", "hello"}) || got[1].Name != "b.bin" || got[1].Type != "application/x-evil" || got[1].Content != "\x00\x01\x02" {
		t.Fatalf("received %+v", got)
	}
}

func TestUploadRejectsBadInput(t *testing.T) {
	s, base := launchFixture(t)
	if _, err := s.Navigate(base+"/upload-plain", 0); err != nil {
		t.Fatal(err)
	}
	ref := refFor(t, snap(t, s), "Plain upload")
	dir := s.uploadRoot()
	big := make([]byte, maxUploadBytes+1)
	for name, files := range map[string][]UploadFile{
		"directory":    {{Path: dir}},
		"missing":      {{Path: filepath.Join(dir, "nope")}},
		"relative":     {{Path: "x.txt"}},
		"no files":     nil,
		"oversize":     {{Name: "big", Content: string(big)}},
		"both sources": {{Path: dir, Content: "x"}},
		"bad base64":   {{Name: "a", ContentBase64: "***"}},
		"no name":      {{Content: "x"}},
	} {
		if _, err := s.Upload(ref, files, 0); err == nil {
			t.Errorf("%s: want error", name)
		}
	}
	if n := len(uploads(t, base)); n != 0 {
		t.Fatalf("server received %d files", n)
	}
}

func TestUploadConfinedToRoot(t *testing.T) {
	s, base := launchFixture(t)
	if _, err := s.Navigate(base+"/upload-plain", 0); err != nil {
		t.Fatal(err)
	}
	ref := refFor(t, snap(t, s), "Plain upload")
	root := s.uploadRoot()
	outside := filepath.Join(t.TempDir(), "secret.txt")
	os.WriteFile(outside, []byte("secret"), 0o600)
	link := filepath.Join(root, "link.txt")
	if err := os.Symlink(outside, link); err != nil {
		t.Fatal(err)
	}
	dirLink := filepath.Join(root, "dir")
	os.Symlink(filepath.Dir(outside), dirLink)
	for name, p := range map[string]string{
		"outside":     outside,
		"symlink":     link,
		"dir symlink": filepath.Join(dirLink, "secret.txt"),
		"dotdot":      filepath.Join(root, "..", filepath.Base(filepath.Dir(outside)), "secret.txt"),
		"dotdot up":   root + "/../../../../../../etc/hosts",
		"sibling":     root + "-evil/x",
	} {
		_, err := s.Upload(ref, []UploadFile{{Path: p}}, 0)
		if err == nil || !strings.Contains(err.Error(), root) {
			t.Errorf("%s: err = %v, want refusal naming %s", name, err, root)
		}
	}
	if n := len(uploads(t, base)); n != 0 {
		t.Fatalf("server received %d files", n)
	}
	inside := filepath.Join(root, "ok.txt")
	os.WriteFile(inside, []byte("fine"), 0o644)
	if _, err := s.Upload(ref, []UploadFile{{Path: inside}}, 0); err != nil {
		t.Fatal(err)
	}
	eventually(t, "inside file", func() bool { return len(uploads(t, base)) == 1 })
}
