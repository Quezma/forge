package browser

import (
	"strings"
	"testing"

	"qa-engineer/internal/fixtureapp"
)

func TestSetViewport(t *testing.T) {
	s, base := launchFixture(t)
	if _, err := s.Navigate(base+"/", 0); err != nil {
		t.Fatal(err)
	}
	v, err := s.SetViewport("mobile", 0, 0)
	if err != nil || v.Width != 390 || !v.HorizontalOverflow {
		t.Fatalf("mobile = %+v, %v", v, err)
	}
	v, err = s.SetViewport("desktop", 0, 0)
	if err != nil || v.Width != 1440 || v.HorizontalOverflow {
		t.Fatalf("desktop = %+v, %v", v, err)
	}
	if _, err := s.SetViewport("watch", 0, 0); err == nil || !strings.Contains(err.Error(), "mobile") {
		t.Errorf("unknown preset err = %v", err)
	}
	if _, err := s.SetViewport("", 0, 600); err == nil {
		t.Error("zero width should fail")
	}
	if v, err := s.SetViewport("", 500, 600); err != nil || v.Width != 500 || v.Height != 600 {
		t.Errorf("custom = %+v, %v", v, err)
	}
}

func TestStorageAndNewContext(t *testing.T) {
	s, base := launchFixture(t)
	login(t, s, base, fixtureapp.Password)
	eventually(t, "session cookie", func() bool {
		st, err := s.Storage()
		if err != nil {
			return false
		}
		for _, c := range st.Cookies {
			if c.Name == "session" && c.HttpOnly {
				return true
			}
		}
		return false
	})
	if err := s.NewContext(); err != nil {
		t.Fatal(err)
	}
	st, err := s.Storage()
	if err != nil {
		t.Fatal(err)
	}
	if len(st.Cookies) != 0 || st.LocalStorage == nil || st.SessionStorage == nil {
		t.Fatalf("after new context: %+v", st)
	}
}

func TestInterceptMockAndClear(t *testing.T) {
	s, base := launchFixture(t)
	if err := s.Intercept(InterceptSpec{Pattern: "**/api/login", Action: "mock", Status: 503, Body: `{"error":"Service down"}`}); err != nil {
		t.Fatal(err)
	}
	login(t, s, base, fixtureapp.Password)
	eventually(t, "mocked error", func() bool { return strings.Contains(snap(t, s), "Service down") })

	if err := s.Intercept(InterceptSpec{Pattern: "**/api/login", Action: "clear"}); err != nil {
		t.Fatal(err)
	}
	login(t, s, base, "wrong")
	eventually(t, "real error", func() bool { return strings.Contains(snap(t, s), "Invalid email or password") })
}

func TestInterceptBlock(t *testing.T) {
	s, base := launchFixture(t)
	if err := s.Intercept(InterceptSpec{Pattern: "**/api/login", Action: "block"}); err != nil {
		t.Fatal(err)
	}
	login(t, s, base, fixtureapp.Password)
	eventually(t, "blocked request", func() bool {
		for _, e := range s.NetworkLog(false, "/api/login") {
			if e.Failure != "" {
				return true
			}
		}
		return false
	})
}

func TestInterceptValidation(t *testing.T) {
	s := &Session{}
	cases := map[string]InterceptSpec{
		"pattern":                   {Action: "block"},
		"delay_ms":                  {Pattern: "**/x", Action: "delay"},
		"block, delay, mock, clear": {Pattern: "**/x", Action: "explode"},
	}
	for want, sp := range cases {
		if err := s.Intercept(sp); err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%+v: err = %v, want containing %q", sp, err, want)
		}
	}
}

func TestA11yAudit(t *testing.T) {
	s, base := launchFixture(t)
	if _, err := s.Navigate(base+"/", 0); err != nil {
		t.Fatal(err)
	}
	vs, err := s.A11yAudit()
	if err != nil {
		t.Fatal(err)
	}
	for _, v := range vs {
		if v.ID == "image-alt" {
			return
		}
	}
	t.Fatalf("image-alt not found: %+v", vs)
}
