package audio

/*
#cgo CFLAGS: -O2
#cgo darwin LDFLAGS: -framework CoreAudio -framework CoreFoundation -framework AudioToolbox -lpthread -lm
#cgo windows LDFLAGS: -lole32 -lwinmm
#cgo linux LDFLAGS: -lpthread -lm -ldl
#include <stdlib.h>
#include "shim.h"
*/
import "C"

import (
	"fmt"
	"strings"
	"time"
	"unsafe"
)

// Everything crosses this package at 48 kHz: capture as mono int16 in 20 ms frames (the
// Opus frame we send), playback as interleaved stereo int16.
const (
	SampleRate  = 48000
	FrameMs     = 20
	FrameLen    = SampleRate * FrameMs / 1000 // 960 samples per channel
	OutChannels = 2
)

// PeriodMs is the device period. The rings are pumped every PumpMs from Go; the ring holds
// RingMs so a late pump is a late pump and not a dropout.
var (
	PeriodMs = 10
	// Every wake of a Go thread costs on the order of 100 µs on macOS (kevent, then a mach
	// semaphore), and the profile of a client doing nothing but pumping was mostly that. So
	// the pump runs at 20 ms, and everything periodic in the audio path rides on it.
	PumpMs = 20
	RingMs = 100
	// PlayAheadMs is how much decoded audio the pump keeps in the playback ring: enough to
	// cover a late tick, little enough not to add latency you can hear.
	PlayAheadMs = 40
)

// Engine owns the miniaudio context — the one native dependency for audio I/O on every
// platform (CoreAudio, WASAPI, ALSA/PulseAudio), compiled into the binary from shim.c.
type Engine struct{}

type Device struct {
	Name    string
	Index   int
	Default bool
}

func NewEngine() (*Engine, error) {
	if C.om_init() != 0 {
		return nil, fmt.Errorf("audio context: miniaudio failed to initialise")
	}
	return &Engine{}, nil
}

func (e *Engine) Close() {}

func (e *Engine) list(playback bool) ([]Device, error) {
	pb := C.int(0)
	if playback {
		pb = 1
	}
	n := int(C.om_device_count(pb))
	out := make([]Device, 0, n)
	buf := (*C.char)(C.malloc(256))
	defer C.free(unsafe.Pointer(buf))
	for i := 0; i < n; i++ {
		var def C.int
		if C.om_device_name(pb, C.int(i), buf, 256, &def) != 0 {
			continue
		}
		out = append(out, Device{Name: C.GoString(buf), Index: i, Default: def != 0})
	}
	return out, nil
}

func (e *Engine) Inputs() ([]Device, error)  { return e.list(false) }
func (e *Engine) Outputs() ([]Device, error) { return e.list(true) }

// Find picks a device by a case-insensitive substring of its name, or the default when
// name is empty (nil: the driver chooses).
func Find(devices []Device, name string) (*Device, error) {
	if name == "" {
		return nil, nil
	}
	needle := strings.ToLower(name)
	for i := range devices {
		if strings.Contains(strings.ToLower(devices[i].Name), needle) {
			return &devices[i], nil
		}
	}
	return nil, fmt.Errorf("no audio device matches %q", name)
}

// Stream is one open device and its ring.
type Stream struct {
	s        *C.om_stream
	channels int
}

func (e *Engine) open(playback bool, dev *Device, channels int) (*Stream, error) {
	pb, idx := C.int(0), C.int(-1)
	if playback {
		pb = 1
	}
	if dev != nil {
		idx = C.int(dev.Index)
	}
	s := C.om_open(pb, idx, C.int(channels), SampleRate, C.int(PeriodMs), C.int(RingMs))
	if s == nil {
		kind := "capture"
		if playback {
			kind = "playback"
		}
		return nil, fmt.Errorf("%s device: could not open", kind)
	}
	return &Stream{s: s, channels: channels}, nil
}

func (st *Stream) Close()         { C.om_close(st.s) }
func (st *Stream) Rate() int      { return int(C.om_rate(st.s)) }
func (st *Stream) Available() int { return int(C.om_available(st.s)) }
func (st *Stream) Underruns() int { return int(C.om_underruns(st.s)) }
func (st *Stream) read(buf []int16) int {
	return int(C.om_read(st.s, (*C.int16_t)(unsafe.Pointer(&buf[0])), C.int(len(buf)/st.channels)))
}
func (st *Stream) write(buf []int16) int {
	return int(C.om_write(st.s, (*C.int16_t)(unsafe.Pointer(&buf[0])), C.int(len(buf)/st.channels)))
}

// Pump moves audio between the device rings and the pipeline on a goroutine of our own:
// every PumpMs it hands whatever the microphone captured to onPCM and keeps PlayAheadMs of
// mixed audio in the playback ring. The audio threads never see Go.
type Pump struct {
	capture  *Stream
	playback *Stream
	stop     chan struct{}
	done     chan struct{}
}

func (e *Engine) StartPump(in, out *Device, onPCM func(pcm []int16), fill func(out []int16)) (*Pump, error) {
	capture, err := e.open(false, in, 1)
	if err != nil {
		return nil, err
	}
	playback, err := e.open(true, out, OutChannels)
	if err != nil {
		capture.Close()
		return nil, err
	}
	p := &Pump{capture: capture, playback: playback, stop: make(chan struct{}), done: make(chan struct{})}
	go p.run(onPCM, fill)
	return p, nil
}

func (p *Pump) run(onPCM func([]int16), fill func([]int16)) {
	defer close(p.done)
	inBuf := make([]int16, SampleRate*RingMs/1000)
	// Playback is written in 10 ms pieces, so the ring is topped up rather than refilled.
	piece := SampleRate * 10 / 1000 * OutChannels
	outBuf := make([]int16, piece)
	ahead := SampleRate * PlayAheadMs / 1000
	ringFrames := SampleRate * RingMs / 1000
	t := time.NewTicker(time.Duration(PumpMs) * time.Millisecond)
	defer t.Stop()
	for {
		select {
		case <-p.stop:
			return
		case <-t.C:
			if n := p.capture.read(inBuf); n > 0 {
				onPCM(inBuf[:n])
			}
			for ringFrames-p.playback.Available() < ahead {
				fill(outBuf)
				if p.playback.write(outBuf) < len(outBuf)/OutChannels {
					break
				}
			}
		}
	}
}

// Describe says what the devices are really running at.
func (p *Pump) Describe() string {
	return fmt.Sprintf("capture %d Hz, playback %d Hz, ring %d ms, pump every %d ms", p.capture.Rate(), p.playback.Rate(), RingMs, PumpMs)
}

// Underruns is how often the playback callback found the ring empty, plus capture overruns.
func (p *Pump) Underruns() int { return p.playback.Underruns() + p.capture.Underruns() }

func (p *Pump) Close() {
	close(p.stop)
	<-p.done
	p.capture.Close()
	p.playback.Close()
}
