package audio

import "math"

// Resampler is a streaming polyphase sample-rate converter for interleaved int16 audio,
// a port of the Node client's (`packages/terminal/src/lib/audio/resampler.ts`, ≈90 dB
// SNR). Devices run at whatever rate they like — 44.1 kHz USB mixers, 96 kHz interfaces,
// 16 kHz Bluetooth headsets — and the pipeline is always 48 kHz; converting here keeps
// the driver's resampler out of the path. miniaudio's is linear interpolation behind a
// low-order filter, which is what made the Roland at 44.1 kHz sound duller from Windows
// than the same microphone through Apple's converter on the Mac.
//
// Rational ratio L/M, a Kaiser-windowed sinc prototype designed at the L× rate and
// evaluated as L polyphase branches; stateful, so any input chunking works.
type Resampler struct {
	channels int
	l, m     int
	taps     int       // per branch
	h        []float32 // prototype, taps*l long, scaled by l
	buf      []int16   // history + pending input, interleaved
	pos      int       // frame index of the next output's base input frame
	phase    int
	out      []int16
}

func gcd(a, b int) int {
	for b != 0 {
		a, b = b, a%b
	}
	return a
}

func besselI0(x float64) float64 {
	sum, term := 1.0, 1.0
	y := (x / 2) * (x / 2)
	for k := 1; k < 50; k++ {
		term *= y / float64(k*k)
		sum += term
		if term < sum*1e-12 {
			break
		}
	}
	return sum
}

func NewResampler(inRate, outRate, channels int) *Resampler {
	g := gcd(inRate, outRate)
	r := &Resampler{channels: channels, l: outRate / g, m: inRate / g}
	// Enough taps that decimation still has a steep anti-alias filter.
	r.taps = int(math.Ceil(32 * math.Max(1, float64(r.m)/float64(r.l))))
	n := r.taps * r.l
	cutoff := float64(min(inRate, outRate)) / 2 * 0.92 // a guard band
	fc := cutoff / float64(inRate*r.l)
	const beta = 8.6 // ~-90 dB stop-band
	denom := besselI0(beta)
	mid := float64(n-1) / 2
	r.h = make([]float32, n)
	sum := 0.0
	for i := range n {
		t := float64(i) - mid
		sinc := 2 * fc
		if t != 0 {
			sinc = math.Sin(2*math.Pi*fc*t) / (math.Pi * t)
		}
		x := float64(2*i)/float64(n-1) - 1
		w := besselI0(beta*math.Sqrt(math.Max(0, 1-x*x))) / denom
		r.h[i] = float32(sinc * w)
		sum += sinc * w
	}
	scale := float32(float64(r.l) / sum)
	for i := range r.h {
		r.h[i] *= scale
	}
	r.buf = make([]int16, 0, (r.taps+inRate/10)*channels)
	// The first output waits for the first taps frames: no zero history, no added delay.
	r.pos = r.taps - 1
	return r
}

// Process converts input (interleaved, any frame count) and returns every output sample
// available now. The slice is reused by the next call.
func (r *Resampler) Process(in []int16) []int16 {
	ch := r.channels
	r.buf = append(r.buf, in...)
	frames := len(r.buf) / ch
	maxOut := (frames-r.pos)*r.l/r.m + 2
	if cap(r.out) < maxOut*ch {
		r.out = make([]int16, maxOut*ch)
	}
	r.out = r.out[:maxOut*ch]
	n := 0
	for r.pos < frames {
		base := r.pos * ch
		for c := range ch {
			var acc float32
			idx, k := base+c, r.phase
			for range r.taps {
				acc += r.h[k] * float32(r.buf[idx])
				k += r.l
				idx -= ch
			}
			r.out[n*ch+c] = clamp16(acc)
		}
		n++
		step := r.phase + r.m
		r.pos += step / r.l
		r.phase = step % r.l
	}
	if keepFrom := r.pos - (r.taps - 1); keepFrom > 0 {
		r.buf = append(r.buf[:0], r.buf[keepFrom*ch:]...)
		r.pos -= keepFrom
	}
	return r.out[:n*ch]
}

func clamp16(v float32) int16 {
	if v > 32767 {
		return 32767
	}
	if v < -32768 {
		return -32768
	}
	return int16(math.Round(float64(v)))
}
