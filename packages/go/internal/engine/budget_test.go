package engine

import "testing"

// The budget is the whole of "the voice has priority", so the rule it follows is worth
// pinning: it grows while the round trip is at its baseline and gives way as soon as the
// queue the transfer is filling shows up in it.
func TestTheBudgetYieldsToTheCall(t *testing.T) {
	e := &Engine{}
	p := &peerInfo{baseRTT: 40, prevRTT: 40}
	e.adjustFileBudget(p)
	start := p.fileKbps
	if start <= 0 {
		t.Fatalf("no budget to begin with: %d", start)
	}

	// A calm link: it climbs.
	for i := 0; i < 4; i++ {
		e.adjustFileBudget(p)
	}
	climbed := p.fileKbps
	if climbed <= start {
		t.Errorf("a calm call did not let the transfer grow: %d → %d", start, climbed)
	}

	// The round trip triples: the file gets out of the way, and keeps getting out of it.
	p.prevRTT = p.baseRTT + 200
	e.adjustFileBudget(p)
	if p.fileKbps >= climbed {
		t.Errorf("a call in trouble did not slow the transfer: %d → %d", climbed, p.fileKbps)
	}
	for i := 0; i < 20; i++ {
		e.adjustFileBudget(p)
	}
	if p.fileKbps != fileFloorKbps {
		t.Errorf("it stopped at %d, want the floor %d", p.fileKbps, fileFloorKbps)
	}

	// The call recovers and so does the transfer.
	p.prevRTT = p.baseRTT
	e.adjustFileBudget(p)
	if p.fileKbps <= fileFloorKbps {
		t.Errorf("it never came back up: %d", p.fileKbps)
	}
}

// Unlimited is unlimited, and a flat ceiling is flat, whatever the call is doing.
func TestTheModesMeanWhatTheySay(t *testing.T) {
	for _, c := range []struct {
		mode string
		want int
	}{{"unlimited", 0}, {"capped", 2000}} {
		e := &Engine{opts: Options{FileTransfer: c.mode}}
		if got := e.fileBudget("nobody"); got != c.want {
			t.Errorf("%s gave %d, want %d", c.mode, got, c.want)
		}
	}
}
