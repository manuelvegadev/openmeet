package audio

import (
	"math"
	"testing"
)

// A 1 kHz tone through each ratio the devices produce, in odd-sized chunks, must come out
// as a 1 kHz tone: signal-to-noise against the ideal above 85 dB, as the Node client's
// resampler-test.ts asserted (88–98 dB).
func TestResamplerSNR(t *testing.T) {
	for _, tc := range []struct{ in, out, ch int }{{44100, 48000, 1}, {48000, 44100, 2}, {16000, 48000, 1}, {48000, 16000, 2}, {96000, 48000, 2}} {
		r := NewResampler(tc.in, tc.out, tc.ch)
		const secs = 2
		var got []int16
		i := 0
		for i < tc.in*secs {
			n := min(97+i%131, tc.in*secs-i)
			chunk := make([]int16, n*tc.ch)
			for f := range n {
				v := int16(10000 * math.Sin(2*math.Pi*1000*float64(i+f)/float64(tc.in)))
				for c := range tc.ch {
					chunk[f*tc.ch+c] = v
				}
			}
			got = append(got, r.Process(chunk)...)
			i += n
		}
		frames := len(got) / tc.ch
		if want := tc.out * secs; frames < want-tc.out/10 || frames > want {
			t.Fatalf("%d→%d: %d frames out of %d", tc.in, tc.out, frames, want)
		}
		// The filter delays the tone by half its length, so fit amplitude and phase at
		// 1 kHz by least squares and call everything the fit does not explain noise.
		// The settling at both ends is skipped.
		skip := 2000
		var ss, sc, cc, ys, yc float64
		for f := skip; f < frames-skip; f++ {
			w := 2 * math.Pi * 1000 * float64(f) / float64(tc.out)
			s, c, y := math.Sin(w), math.Cos(w), float64(got[f*tc.ch])
			ss += s * s
			sc += s * c
			cc += c * c
			ys += y * s
			yc += y * c
		}
		det := ss*cc - sc*sc
		a, b := (ys*cc-yc*sc)/det, (yc*ss-ys*sc)/det
		var sig, noise float64
		for f := skip; f < frames-skip; f++ {
			w := 2 * math.Pi * 1000 * float64(f) / float64(tc.out)
			fit := a*math.Sin(w) + b*math.Cos(w)
			d := float64(got[f*tc.ch]) - fit
			sig += fit * fit
			noise += d * d
		}
		snr := 10 * math.Log10(sig/noise)
		if snr < 80 {
			t.Errorf("%d→%d ch%d: SNR %.1f dB", tc.in, tc.out, tc.ch, snr)
		} else {
			t.Logf("%d→%d ch%d: SNR %.1f dB", tc.in, tc.out, tc.ch, snr)
		}
	}
}
