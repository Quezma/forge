package browser

import (
	"encoding/base64"
	"errors"
	"fmt"
	"mime"
	"os"
	"path/filepath"
	"strings"

	playwright "github.com/mxschmitt/playwright-go"
)

// maxUploadBytes caps the total size of the files set in one Upload call.
const maxUploadBytes = 50 << 20

// UploadFile is one file to upload: either a local Path or an inline payload
// (Name plus Content as text or ContentBase64). MimeType overrides detection.
type UploadFile struct {
	Path          string `json:"path,omitempty"`
	Name          string `json:"name,omitempty"`
	MimeType      string `json:"mime_type,omitempty"`
	Content       string `json:"content,omitempty"`
	ContentBase64 string `json:"content_base64,omitempty"`
}

// UploadedFile describes a file that was set on the page.
type UploadedFile struct {
	Name     string `json:"name"`
	Size     int    `json:"size"`
	MimeType string `json:"mime_type"`
}

// UploadResult reports what was set and how.
type UploadResult struct {
	Files       []UploadedFile `json:"files"`
	UsedChooser bool           `json:"used_chooser"`
}

// confine resolves path (following symlinks) and returns it only if it lies inside root.
func confine(root, path string) (string, error) {
	hint := fmt.Sprintf("put files under the upload root %s", root)
	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", fmt.Errorf("upload root %s is not usable: %w", root, err)
	}
	real, err := filepath.EvalSymlinks(path)
	if err != nil {
		return "", fmt.Errorf("%w (%s)", err, hint)
	}
	rel, err := filepath.Rel(realRoot, real)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("path %q is outside the upload root: %s, or send the content inline with files", path, hint)
	}
	return real, nil
}

func loadUploads(root string, files []UploadFile) ([]playwright.InputFile, error) {
	if len(files) == 0 {
		return nil, errors.New("upload: no files given")
	}
	var out []playwright.InputFile
	total := 0
	for i, f := range files {
		inline := f.Content != "" || f.ContentBase64 != ""
		if (f.Path != "") == inline {
			return nil, fmt.Errorf("upload file %d: give either path or content/content_base64 (not both)", i)
		}
		in := playwright.InputFile{Name: f.Name, MimeType: f.MimeType}
		if f.Path != "" {
			if !filepath.IsAbs(f.Path) {
				return nil, fmt.Errorf("upload file %d: path %q must be absolute", i, f.Path)
			}
			real, err := confine(root, f.Path)
			if err != nil {
				return nil, fmt.Errorf("upload file %d: %w", i, err)
			}
			st, err := os.Stat(real)
			if err != nil {
				return nil, fmt.Errorf("upload file %d: %w", i, err)
			}
			if !st.Mode().IsRegular() {
				return nil, fmt.Errorf("upload file %d: %q is not a regular file", i, f.Path)
			}
			if total += int(st.Size()); total > maxUploadBytes {
				return nil, fmt.Errorf("upload: total size exceeds the %d MB limit", maxUploadBytes>>20)
			}
			b, err := os.ReadFile(real)
			if err != nil {
				return nil, fmt.Errorf("upload file %d: %w", i, err)
			}
			in.Buffer = b
			if in.Name == "" {
				in.Name = filepath.Base(f.Path)
			}
		} else {
			if f.Name == "" {
				return nil, fmt.Errorf("upload file %d: inline files need a name", i)
			}
			if f.ContentBase64 != "" {
				if total += base64.StdEncoding.DecodedLen(len(f.ContentBase64)); total > maxUploadBytes {
					return nil, fmt.Errorf("upload: total size exceeds the %d MB limit", maxUploadBytes>>20)
				}
				b, err := base64.StdEncoding.DecodeString(f.ContentBase64)
				if err != nil {
					return nil, fmt.Errorf("upload file %d: content_base64: %w", i, err)
				}
				in.Buffer = b
			} else {
				if total += len(f.Content); total > maxUploadBytes {
					return nil, fmt.Errorf("upload: total size exceeds the %d MB limit", maxUploadBytes>>20)
				}
				in.Buffer = []byte(f.Content)
			}
		}
		if in.MimeType == "" {
			in.MimeType = mime.TypeByExtension(filepath.Ext(in.Name))
		}
		if in.MimeType == "" {
			in.MimeType = "application/octet-stream"
		}
		out = append(out, in)
	}
	return out, nil
}

// uploadRoot is the only directory local upload paths may come from.
func (s *Session) uploadRoot() string {
	if s.opts.UploadRoot != "" {
		return s.opts.UploadRoot
	}
	return filepath.Join(s.opts.ArtifactDir, "uploads")
}

// Upload sets files on the element with the given ref. If the element is an
// <input type=file> the files are set on it directly; otherwise the element
// is clicked and the file chooser it opens is answered.
func (s *Session) Upload(ref string, files []UploadFile, timeoutMs int) (UploadResult, error) {
	in, err := loadUploads(s.uploadRoot(), files)
	if err != nil {
		return UploadResult{}, err
	}
	res := UploadResult{}
	for _, f := range in {
		res.Files = append(res.Files, UploadedFile{Name: f.Name, Size: len(f.Buffer), MimeType: f.MimeType})
	}
	err = s.act("upload", ref, func(l playwright.Locator) error {
		isInput, err := l.Evaluate(`el => el.tagName === 'INPUT' && el.type === 'file'`, nil, playwright.LocatorEvaluateOptions{Timeout: playwright.Float(timeout(timeoutMs))})
		if err != nil {
			return err
		}
		if ok, _ := isInput.(bool); ok {
			return l.SetInputFiles(in, playwright.LocatorSetInputFilesOptions{Timeout: playwright.Float(timeout(timeoutMs))})
		}
		res.UsedChooser = true
		fc, err := s.page.ExpectFileChooser(func() error {
			return l.Click(playwright.LocatorClickOptions{Timeout: playwright.Float(timeout(timeoutMs))})
		}, playwright.PageExpectFileChooserOptions{Timeout: playwright.Float(timeout(timeoutMs))})
		if err != nil {
			return fmt.Errorf("no file chooser opened by this element (is it a file input, or a control that opens one?): %w", err)
		}
		return fc.SetFiles(in)
	})
	return res, err
}
