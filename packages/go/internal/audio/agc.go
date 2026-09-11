package audio

import "math"

// AutomaticGain levels a voice: the quiet talker and the hot interface arrive at the same
// loudness, which is most of what "the other side sounds better" turns out to mean. Apple's
// voice processing unit does this on macOS and Windows' communications mode does it where
// the endpoint's driver offers it; this is ours, for everywhere else — a USB interface whose
// driver has no processing at all, which is the common case on Windows.
//
// The rules that keep it from being the usual nuisance:
//
//   - It only adapts while there is a voice to measure. Given silence it holds the gain it
//     had, so a pause never ramps the room's noise up to speech level.
//   - It moves slowly once it is close, agcRateDB per second, so a sentence is not pumped;
//     far from the target — the first words of a call, a device swapped mid-call — it
//     closes the distance at agcFastDB per second instead of taking half a minute.
//   - It never lets a frame clip: a peak that would pass full scale drops the gain at once,
//     before the sample is written, and the drop stays.
type AutomaticGain struct {
	gain float64
}

const (
	// Target loudness, in RMS of int16: about -20 dBFS, where speech normally sits.
	agcTargetRMS = 3000.0
	// Only a frame at least this loud says anything about how loud the speaker is.
	agcFloorRMS = 150.0
	agcRateDB   = 3.0  // per second, once within agcNearDB of the target
	agcFastDB   = 12.0 // per second while further away than that
	agcNearDB   = 6.0
	agcMaxGain  = 8.0 // +18 dB
	agcMinGain  = 0.2 // -14 dB
	// Peaks above this are brought down immediately; full scale with a little room.
	agcCeiling = 30000.0
)

func NewAutomaticGain() *AutomaticGain { return &AutomaticGain{gain: 1} }

// Gain is the factor in use, for the debug line.
func (a *AutomaticGain) Gain() float64 { return a.gain }

// Apply levels one frame in place. rms is the frame's own, measured before any gain.
func (a *AutomaticGain) Apply(frame []int16, rms float64) {
	if rms > agcFloorRMS {
		// Where the gain wants to be, and one frame's worth of the way towards it.
		want := agcTargetRMS / rms
		rate := agcRateDB
		if math.Abs(20*math.Log10(want/a.gain)) > agcNearDB {
			rate = agcFastDB
		}
		step := math.Pow(10, rate*(FrameMs/1000.0)/20)
		if want > a.gain {
			a.gain = math.Min(want, a.gain*step)
		} else {
			a.gain = math.Max(want, a.gain/step)
		}
		a.gain = math.Max(agcMinGain, math.Min(agcMaxGain, a.gain))
	}
	if a.gain == 1 {
		return
	}
	// A peak that would clip takes the gain down with it, so the loud syllable that
	// arrives before the average catches up is not a burst of distortion.
	var peak float64
	for _, v := range frame {
		if p := math.Abs(float64(v)); p > peak {
			peak = p
		}
	}
	if peak*a.gain > agcCeiling {
		a.gain = agcCeiling / peak
	}
	for i, v := range frame {
		frame[i] = clamp16(float32(float64(v) * a.gain))
	}
}
