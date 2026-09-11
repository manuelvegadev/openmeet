package audio

import "testing"

const frameMs = 20.0

type clock struct{ now float64 }

func run(g *VoiceGate, rms, ms float64, c *clock) int {
	frame := make([]int16, 960)
	sent := 0
	for t := 0.0; t < ms; t += frameMs {
		sent += len(g.Step(frame, rms, c.now))
		c.now += frameMs
	}
	return sent
}

const (
	speech    = SpeakingRMSThreshold * 2
	quietRoom = 8.0
	noisyRoom = 200.0
)

func TestSilenceNeverOpens(t *testing.T) {
	g, c := NewVoiceGate(960), &clock{}
	if sent := run(g, quietRoom, 2000, c); sent != 0 || g.IsOpen() {
		t.Fatalf("silence opened the gate: sent %d open %v", sent, g.IsOpen())
	}
}

func TestVoiceOpensWithAttack(t *testing.T) {
	g, c := NewVoiceGate(960), &clock{}
	run(g, quietRoom, 500, c)
	first := len(g.Step(make([]int16, 960), speech, c.now))
	c.now += frameMs
	if !g.IsOpen() || first != prebufferFrames+1 {
		t.Fatalf("first loud frame: open %v, sent %d (want %d)", g.IsOpen(), first, prebufferFrames+1)
	}
	if sent := run(g, speech, 1000, c); sent != 50 {
		t.Fatalf("while open: sent %d of 50", sent)
	}
}

func TestPauseDoesNotCut(t *testing.T) {
	g, c := NewVoiceGate(960), &clock{}
	run(g, quietRoom, 500, c)
	run(g, speech, 300, c)
	during := run(g, quietRoom, 200, c)
	if !g.IsOpen() || during != 10 {
		t.Fatalf("200 ms pause: open %v, sent %d", g.IsOpen(), during)
	}
	run(g, quietRoom, 200, c)
	if g.IsOpen() {
		t.Fatal("still open past the hold")
	}
}

func TestNoiseNeverOpensButVoiceDoes(t *testing.T) {
	g, c := NewVoiceGate(960), &clock{}
	if sent := run(g, noisyRoom, 3000, c); sent != 0 {
		t.Fatalf("noise opened the gate: sent %d", sent)
	}
	if th := g.OpenThreshold(); th <= noisyRoom || th > SpeakingRMSThreshold {
		t.Fatalf("threshold %v after noise", th)
	}
	run(g, speech, 100, c)
	if !g.IsOpen() {
		t.Fatal("voice did not open it over noise")
	}
}

func TestQuietVoiceInQuietRoom(t *testing.T) {
	g, c := NewVoiceGate(960), &clock{}
	run(g, quietRoom, 1000, c)
	soft := SpeakingRMSThreshold / 4
	if g.OpenThreshold() >= soft {
		t.Fatalf("quiet room did not lower the bar: %v", g.OpenThreshold())
	}
	run(g, soft, 100, c)
	if !g.IsOpen() {
		t.Fatal("a quiet voice was not heard")
	}
}

func TestNeverStricterThanTheDot(t *testing.T) {
	g, c := NewVoiceGate(960), &clock{}
	if g.OpenThreshold() != SpeakingRMSThreshold {
		t.Fatalf("fresh gate opens at %v", g.OpenThreshold())
	}
	run(g, SpeakingRMSThreshold, 100, c)
	if !g.IsOpen() {
		t.Fatal("a voice at the old threshold did not open it")
	}
}
