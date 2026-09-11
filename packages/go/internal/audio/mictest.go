package audio

import (
	"math"
	"sync"
	"sync/atomic"
	"time"
)

// MicTest is the device picker's meter and test tone: the chosen input's level with the
// meter's ballistics, and a second of 440 Hz on the chosen output when asked. It is a pump
// with a level follower instead of a gate and a tone instead of a mix.
type MicTest struct {
	pump  *Pump
	mu    sync.Mutex
	level float64
	tone  atomic.Int64 // samples of tone still to play
	phase float64
}

const (
	// The meter's release: 20 dB/s, as the Node client's followLevel has it.
	vuReleasePerFrame = 0.9977 // 10^(-(20/100)/20) per 10 ms frame
	toneHz            = 440.0
	toneGain          = 0.2
)

// FollowLevel: the new level is the frame's RMS if louder, else the old one released a frame.
func FollowLevel(shown, rms float64) float64 {
	return math.Max(rms, shown*vuReleasePerFrame)
}

func (e *Engine) StartMicTest(in, out *Device) (*MicTest, error) {
	m := &MicTest{}
	pump, err := e.StartPump(in, out, m.onPCM, m.fill)
	if err != nil {
		return nil, err
	}
	m.pump = pump
	return m, nil
}

func (m *MicTest) onPCM(pcm []int16) {
	// Per 10 ms slice, so the ballistics run at the rate they were tuned for.
	step := SampleRate / 100
	m.mu.Lock()
	for i := 0; i+step <= len(pcm); i += step {
		m.level = FollowLevel(m.level, RMS(pcm[i:i+step]))
	}
	m.mu.Unlock()
}

func (m *MicTest) fill(out []int16) {
	left := m.tone.Load()
	for i := 0; i < len(out); i += OutChannels {
		var v int16
		if left > 0 {
			v = int16(toneGain * 32767 * math.Sin(m.phase))
			m.phase += 2 * math.Pi * toneHz / SampleRate
			left--
		}
		for ch := 0; ch < OutChannels; ch++ {
			out[i+ch] = v
		}
	}
	m.tone.Store(left)
}

// Level is the meter's current value, on the int16 RMS scale.
func (m *MicTest) Level() float64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.level
}

// PlayTone plays a second of 440 Hz on the output.
func (m *MicTest) PlayTone() { m.tone.Store(SampleRate) }

func (m *MicTest) Close() { m.pump.Close() }

var _ = time.Second
