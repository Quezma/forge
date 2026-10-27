package browser

import (
	"fmt"
	"net"
	"sync/atomic"
	"testing"
	"time"
)

// WebRTC sends UDP directly, outside the HTTP proxy. A page must not be able
// to reach a disallowed host that way.
func TestWebRTCCannotBypassGuard(t *testing.T) {
	s, base := launchFixture(t)
	conn, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	var packets atomic.Int32
	go func() {
		buf := make([]byte, 2048)
		for {
			if _, _, err := conn.ReadFrom(buf); err != nil {
				return
			}
			packets.Add(1)
		}
	}()

	if _, err := s.Navigate(base+"/", 0); err != nil {
		t.Fatal(err)
	}
	stun := fmt.Sprintf("stun:%s", conn.LocalAddr().String())
	if _, err := s.page.Evaluate(`async (url) => {
		const pc = new RTCPeerConnection({iceServers: [{urls: url}]});
		pc.createDataChannel("x");
		await pc.setLocalDescription(await pc.createOffer());
		await new Promise(r => setTimeout(r, 1500));
		pc.close();
	}`, stun); err != nil {
		t.Fatal(err)
	}
	time.Sleep(200 * time.Millisecond)
	if n := packets.Load(); n > 0 {
		t.Fatalf("page sent %d UDP packets to a host outside allowed_hosts", n)
	}
}
