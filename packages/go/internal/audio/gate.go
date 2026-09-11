package audio

import "math"

// VoiceGate decides whether we are on the air. A port of the Node client's
// lib/audio/voice-gate.ts, constant for constant, so the two clients behave the same in a
// room and scripts/voice-gate-test.ts and gate_test.go pin the same behaviour.
//
// It measures the room's noise floor only while shut, opens ~10 dB above it — never above
// SpeakingRMSThreshold, never below minOpenRMS — keeps a short ring of frames behind it so
// the consonant that starts a word goes out ahead of the first loud frame, and closes with
// hysteresis and a hold so a pause between words is not a hole in the sentence.

// SpeakingRMSThreshold is the level the speaking dot has always used (~2.5% of full scale).
const SpeakingRMSThreshold = 800.0

const (
	prebufferFrames = 4
	holdMs          = 300.0
	openOverFloor   = 3.0
	closeFraction   = 0.5
	minOpenRMS      = 120.0
	floorMax        = SpeakingRMSThreshold / openOverFloor
	floorFall       = 0.1
	floorRise       = 1.0002
)

type VoiceGate struct {
	frameLen  int
	floor     float64
	open      bool
	holdUntil float64
	ring      [][]int16
	ringHead  int
	ringCount int
	out       [][]int16
}

// NewVoiceGate makes a gate for frames of frameLen samples (mono, 20 ms → 960).
func NewVoiceGate(frameLen int) *VoiceGate {
	g := &VoiceGate{frameLen: frameLen, floor: floorMax, ring: make([][]int16, prebufferFrames)}
	for i := range g.ring {
		g.ring[i] = make([]int16, frameLen)
	}
	return g
}

func (g *VoiceGate) IsOpen() bool { return g.open }

// OpenThreshold is the RMS that would open the gate right now.
func (g *VoiceGate) OpenThreshold() float64 {
	return math.Min(math.Max(g.floor*openOverFloor, minOpenRMS), SpeakingRMSThreshold)
}

// Close shuts the gate without forgetting the room: what muting does.
func (g *VoiceGate) Close() {
	g.open = false
	g.holdUntil = 0
	g.ringCount = 0
}

// Reset forgets the floor too: a new device is a new room.
func (g *VoiceGate) Reset() {
	g.Close()
	g.floor = floorMax
	g.ringHead = 0
}

// Step feeds one capture frame and returns the frames to transmit, oldest first: nothing
// while shut, the buffered attack and this frame on the edge that opens it, this frame alone
// while open. The slice and the buffered frames are reused; consume before the next call.
func (g *VoiceGate) Step(frame []int16, rms float64, nowMs float64) [][]int16 {
	g.out = g.out[:0]
	openAt := g.OpenThreshold()
	if !g.open {
		if rms < g.floor {
			g.floor += (rms - g.floor) * floorFall
		} else {
			g.floor = math.Min(g.floor*floorRise, floorMax)
		}
		if rms < openAt {
			g.remember(frame)
			return g.out
		}
		g.open = true
		g.holdUntil = nowMs + holdMs
		n := len(g.ring)
		for i := 0; i < g.ringCount; i++ {
			g.out = append(g.out, g.ring[(g.ringHead-g.ringCount+i+n)%n])
		}
		g.ringCount = 0
		g.out = append(g.out, frame)
		return g.out
	}
	if rms >= openAt*closeFraction {
		g.holdUntil = nowMs + holdMs
	} else if nowMs >= g.holdUntil {
		g.open = false
		g.remember(frame)
		return g.out
	}
	g.out = append(g.out, frame)
	return g.out
}

func (g *VoiceGate) remember(frame []int16) {
	copy(g.ring[g.ringHead], frame)
	g.ringHead = (g.ringHead + 1) % len(g.ring)
	if g.ringCount < len(g.ring) {
		g.ringCount++
	}
}

// RMS of a PCM frame, on the int16 scale.
func RMS(frame []int16) float64 {
	if len(frame) == 0 {
		return 0
	}
	var sum float64
	for _, s := range frame {
		f := float64(s)
		sum += f * f
	}
	return math.Sqrt(sum / float64(len(frame)))
}
