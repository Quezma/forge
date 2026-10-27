package browser

import (
	"strings"
	"testing"
)

func TestSnapshotRefsReachIntoIframes(t *testing.T) {
	s, base := launchFixture(t)
	if _, err := s.Navigate(base+"/frame", 0); err != nil {
		t.Fatal(err)
	}
	sn := snap(t, s)
	if !strings.Contains(sn, "Accept policy") {
		t.Fatalf("iframe content missing from snapshot:\n%s", sn)
	}
	if err := s.Click(refFor(t, sn, `button "Accept policy"`), 0); err != nil {
		t.Fatal(err)
	}
	if out := snap(t, s); !strings.Contains(out, "Policy accepted") {
		t.Fatalf("click inside iframe had no effect:\n%s", out)
	}
}
