package audio

import (
	"math"
	"testing"
)

func tone(n int, amp float64) []int16 {
	f := make([]int16, n)
	for i := range f {
		f[i] = int16(amp * math.Sin(2*math.Pi*300*float64(i)/SampleRate))
	}
	return f
}

// A quiet voice is brought up to speech level, a loud one down, neither in a jump, and
// neither past full scale.
func TestAutomaticGainLevels(t *testing.T) {
	for _, amp := range []float64{600, 20000} {
		a := NewAutomaticGain()
		var last float64
		for s := 0; s < 150; s++ { // three seconds of frames
			f := tone(FrameLen, amp)
			a.Apply(f, RMS(tone(FrameLen, amp)))
			last = RMS(f)
			for _, v := range f {
				if v == 32767 || v == -32768 {
					t.Fatalf("amp %.0f: clipped at frame %d", amp, s)
				}
			}
		}
		if last < agcTargetRMS*0.7 || last > agcTargetRMS*1.4 {
			t.Errorf("amp %.0f: settled at RMS %.0f, wanted about %.0f", amp, last, agcTargetRMS)
		}
	}
}

// Silence must not move the gain: a pause is not evidence about how loud anyone is.
func TestAutomaticGainHoldsThroughSilence(t *testing.T) {
	a := NewAutomaticGain()
	for range 100 {
		f := tone(FrameLen, 400)
		a.Apply(f, RMS(tone(FrameLen, 400)))
	}
	g := a.Gain()
	for range 500 {
		f := make([]int16, FrameLen)
		a.Apply(f, 0)
	}
	if a.Gain() != g {
		t.Errorf("gain moved through silence: %.2f → %.2f", g, a.Gain())
	}
}

// It rises no faster than it says: three seconds from silence-level gain to a voice 18 dB
// down must take at least the ramp, not one frame.
func TestAutomaticGainIsGradual(t *testing.T) {
	a := NewAutomaticGain()
	f := tone(FrameLen, 400)
	rms := RMS(f)
	a.Apply(f, rms)
	if a.Gain() > math.Pow(10, agcFastDB*(FrameMs/1000.0)/20)+0.001 {
		t.Errorf("one frame moved the gain to %.3f", a.Gain())
	}
}
