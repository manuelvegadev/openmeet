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
	"runtime"
	"strings"
	"sync"
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

// NoPriority leaves the pump's thread at the normal priority: for measuring what the
// priority buys, never for a call.
var NoPriority = false

// NoVoiceProcessing keeps the devices raw instead of asking the system for its voice
// processing unit: for comparing, and as the way out if the unit misbehaves on a machine.
var NoVoiceProcessing = false

// VoiceProcessingBypass keeps Apple's unit (and its Mic Modes) but turns its echo
// canceller, gain control and noise suppressor off: what headphones need, and cheaper.
var VoiceProcessingBypass = false

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
	// Bluetooth is what the platform says (macOS) or what the name says (Windows lists a
	// headset's hands-free endpoint as such). It is what makes the picker warn.
	Bluetooth bool
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
		name := C.GoString(buf)
		tbuf := (*C.char)(C.malloc(8))
		C.om_device_transport(pb, C.int(i), tbuf, 8)
		transport := C.GoString(tbuf)
		C.free(unsafe.Pointer(tbuf))
		lname := strings.ToLower(name)
		bt := transport == "blue" || strings.Contains(lname, "hands-free") || strings.Contains(lname, "bluetooth")
		out = append(out, Device{Name: name, Index: i, Default: def != 0, Bluetooth: bt})
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

// Stream is one open device and its ring — or one side of a duplex unit, which owns both.
// A miniaudio device is opened at its own rate and converted here (`Resampler`), so the
// pipeline sees 48 kHz whatever the device runs at, and neither the driver nor miniaudio
// touches the samples. Apple's unit converts inside itself.
type Stream struct {
	s        *C.om_stream
	channels int
	duplex   bool
	rate     int // the device's own rate; SampleRate when no conversion is needed
	rs       *Resampler
	native   []int16 // a capture's frames at the device rate, before conversion
	carry    []int16 // converted capture frames that did not fit the caller's buffer
}

func (e *Engine) open(playback bool, dev *Device, channels int) (*Stream, error) {
	pb, idx := C.int(0), C.int(-1)
	if playback {
		pb = 1
	}
	if dev != nil {
		idx = C.int(dev.Index)
	}
	voice := C.int(0)
	if !NoVoiceProcessing {
		voice = 1
	}
	s := C.om_open(pb, idx, C.int(channels), 0, C.int(PeriodMs), C.int(RingMs), C.int(PlayAheadMs), voice)
	if s == nil {
		kind := "capture"
		if playback {
			kind = "playback"
		}
		return nil, fmt.Errorf("%s device: could not open", kind)
	}
	st := &Stream{s: s, channels: channels, rate: int(C.om_rate(s))}
	if st.rate != SampleRate {
		if playback {
			st.rs = NewResampler(SampleRate, st.rate, channels)
		} else {
			st.rs = NewResampler(st.rate, SampleRate, channels)
		}
	}
	return st, nil
}

func (st *Stream) Close() { C.om_close(st.s) }

// Rate is the device's own; the stream always reads and writes at SampleRate.
func (st *Stream) Rate() int {
	if st.duplex {
		return int(C.om_rate(st.s))
	}
	return st.rate
}

// Available is in frames at SampleRate, whatever the device runs at.
func (st *Stream) Available() int {
	n := int(C.om_available(st.s))
	if st.rs != nil {
		n = n * SampleRate / st.rate
	}
	return n
}
func (st *Stream) Underruns() int { return int(C.om_underruns(st.s)) }

// read fills buf with frames at SampleRate and returns how many.
func (st *Stream) read(buf []int16) int {
	if st.rs == nil {
		return int(C.om_read(st.s, (*C.int16_t)(unsafe.Pointer(&buf[0])), C.int(len(buf)/st.channels)))
	}
	n := copy(buf, st.carry)
	st.carry = st.carry[:copy(st.carry, st.carry[n:])]
	want := (len(buf) - n) / st.channels * st.rate / SampleRate
	if want > 0 {
		if cap(st.native) < want*st.channels {
			st.native = make([]int16, want*st.channels)
		}
		st.native = st.native[:want*st.channels]
		if got := int(C.om_read(st.s, (*C.int16_t)(unsafe.Pointer(&st.native[0])), C.int(want))); got > 0 {
			out := st.rs.Process(st.native[:got*st.channels])
			k := copy(buf[n:], out)
			n += k
			st.carry = append(st.carry, out[k:]...)
		}
	}
	return n / st.channels
}

// write takes frames at SampleRate and returns how many of them the ring took.
func (st *Stream) write(buf []int16) int {
	if st.rs == nil {
		return int(C.om_write(st.s, (*C.int16_t)(unsafe.Pointer(&buf[0])), C.int(len(buf)/st.channels)))
	}
	out := st.rs.Process(buf)
	if len(out) == 0 {
		return len(buf) / st.channels
	}
	took := int(C.om_write(st.s, (*C.int16_t)(unsafe.Pointer(&out[0])), C.int(len(out)/st.channels)))
	if took < len(out)/st.channels {
		return took * SampleRate / st.rate
	}
	return len(buf) / st.channels
}

// Pump moves audio between the device rings and the pipeline on a goroutine of our own:
// every PumpMs it hands whatever the microphone captured to onPCM and keeps the playback
// ring `ahead` full. The audio threads never see Go.
//
// The goroutine is locked to a thread of its own with the platform's audio priority: under
// a game or a browser on a modest machine an ordinary thread's 20 ms tick arrives late, the
// ring runs dry, and that is the stutter. And when it still runs dry, the pump gives the
// ring more headroom — 20 ms at a time, up to the ring — so latency is only paid under
// pressure, and only as much as the pressure needs.
type Pump struct {
	engine   *Engine
	in, out  *Device // what was asked for; nil is the system default
	capture  *Stream
	playback *Stream
	dup      *C.om_duplex // Apple's voice processing unit, when that is the path
	stop     chan struct{}
	done     chan struct{}
	mu       sync.Mutex
	ahead    int // frames kept in the playback ring
	late     int // ticks that arrived more than a period late
	priority string
	path     string
	reopens  int
	// What the capture side delivered since the last look: frames, and the last RMS.
	capFrames int
	capRMS    float64
	// A chosen device that was not there at the last reopen: the default took its place.
	gone string
	// OnEvent hears about reopens: a device changed its rate or the default moved.
	OnEvent func(msg string)
}

func (e *Engine) StartPump(in, out *Device, onPCM func(pcm []int16), fill func(out []int16)) (*Pump, error) {
	p := &Pump{engine: e, in: in, out: out, stop: make(chan struct{}), done: make(chan struct{}), ahead: SampleRate * PlayAheadMs / 1000}
	// Watch before opening: a Bluetooth headset switches profile — and rate — *because* we
	// open its microphone, so the change lands during the open and must not be missed.
	p.watch()
	if err := p.openStreams(); err != nil {
		C.om_unwatch()
		return nil, err
	}
	go p.run(onPCM, fill)
	return p, nil
}

// openStreams opens the devices: through Apple's voice processing unit where there is
// one (macOS, unless told not to), else as two miniaudio devices.
func (p *Pump) openStreams() error {
	if !NoVoiceProcessing {
		inIdx, outIdx := C.int(-1), C.int(-1)
		if p.in != nil {
			inIdx = C.int(p.in.Index)
		}
		if p.out != nil {
			outIdx = C.int(p.out.Index)
		}
		var cs, ps *C.om_stream
		bypass := C.int(0)
		if VoiceProcessingBypass {
			bypass = 1
		}
		if d := C.om_open_duplex(inIdx, outIdx, SampleRate, C.int(RingMs), C.int(PlayAheadMs), bypass, &cs, &ps); d != nil {
			p.dup = d
			p.capture = &Stream{s: cs, channels: 1, duplex: true}
			p.playback = &Stream{s: ps, channels: OutChannels, duplex: true}
			p.path = "Apple voice processing (Voice Isolation, echo cancellation, gain)"
			if VoiceProcessingBypass {
				p.path = "Apple voice processing, bypassed (Voice Isolation only)"
			}
			return nil
		} else if msg := C.GoString(C.om_duplex_error()); msg != "" && msg != "not on this platform" {
			p.path = "miniaudio (voice processing unit refused: " + msg + ")"
		}
	}
	capture, err := p.engine.open(false, p.in, 1)
	if err != nil {
		return err
	}
	playback, err := p.engine.open(true, p.out, OutChannels)
	if err != nil {
		capture.Close()
		return err
	}
	p.capture, p.playback = capture, playback
	if p.path == "" {
		p.path = "miniaudio (raw devices)"
		if !NoVoiceProcessing && runtime.GOOS == "windows" {
			// What this is worth depends entirely on the endpoint: a laptop's microphone
			// usually brings an APO with echo cancellation and noise suppression, a USB
			// interface often brings nothing at all, and Windows Studio Effects needs a
			// machine with an NPU. Windows does not tell us which of those happened.
			p.path = "Windows communications mode (whatever the device's driver provides)"
		}
	}
	return nil
}

// watch the devices as opened, so a rate or default change reopens them.
func (p *Pump) watch() {
	inIdx, outIdx := C.int(-1), C.int(-1)
	if p.in != nil {
		inIdx = C.int(p.in.Index)
	}
	if p.out != nil {
		outIdx = C.int(p.out.Index)
	}
	C.om_watch(inIdx, outIdx)
}

func (p *Pump) closeStreams() {
	if p.dup != nil {
		C.om_close_duplex(p.dup)
		p.dup = nil
		return
	}
	p.capture.Close()
	p.playback.Close()
}

// reopen follows a device that changed under us — a Bluetooth headset switching profile
// and rate, the default device moving — by opening the same choice again. The names are
// looked up afresh: indices shift when devices come and go.
func (p *Pump) reopen() error {
	p.closeStreams()
	C.om_refresh()
	p.gone = ""
	if p.in != nil {
		if d := p.engine.findByName(false, p.in.Name); d != nil {
			p.in = d
		} else {
			p.gone = p.in.Name
			p.in = nil
		}
	}
	if p.out != nil {
		if d := p.engine.findByName(true, p.out.Name); d != nil {
			p.out = d
		} else {
			p.gone = p.out.Name
			p.out = nil
		}
	}
	p.watch()
	return p.openStreams()
}

func (e *Engine) findByName(playback bool, name string) *Device {
	list, _ := e.list(playback)
	for i := range list {
		if list[i].Name == name {
			return &list[i]
		}
	}
	return nil
}

func (p *Pump) run(onPCM func([]int16), fill func([]int16)) {
	defer close(p.done)
	runtime.LockOSThread()
	if NoPriority {
		p.mu.Lock()
		p.priority = "normal (asked)"
		p.mu.Unlock()
	} else if err := RaiseAudioThread(); err != nil {
		p.mu.Lock()
		p.priority = "normal (" + err.Error() + ")"
		p.mu.Unlock()
	} else {
		p.mu.Lock()
		p.priority = "audio"
		p.mu.Unlock()
	}
	inBuf := make([]int16, SampleRate*RingMs/1000)
	// Playback is written in 10 ms pieces, so the ring is topped up rather than refilled.
	piece := SampleRate * 10 / 1000 * OutChannels
	outBuf := make([]int16, piece)
	ringFrames := SampleRate * RingMs / 1000
	period := time.Duration(PumpMs) * time.Millisecond
	t := time.NewTicker(period)
	defer t.Stop()
	last := time.Now()
	lastUnderruns := p.playback.Underruns()
	started := time.Now()
	for {
		select {
		case <-p.stop:
			return
		case now := <-t.C:
			if C.om_devices_changed() != 0 {
				// Let the change settle — a profile switch takes a moment — then follow it, and
				// let the reopen's own property changes pass without counting as another.
				time.Sleep(300 * time.Millisecond)
				err := p.reopen()
				time.Sleep(200 * time.Millisecond)
				C.om_devices_changed()
				p.mu.Lock()
				p.reopens++
				p.mu.Unlock()
				if p.OnEvent != nil {
					if err != nil {
						p.OnEvent("audio device changed and could not be reopened: " + err.Error())
					} else if p.gone != "" {
						p.OnEvent(p.gone + " is gone; using the system default (" + p.path + ")")
					} else {
						p.OnEvent("audio device changed; reopened (" + p.path + ")")
					}
				}
				if err != nil {
					return
				}
				lastUnderruns = p.playback.Underruns()
				started = time.Now()
				continue
			}
			p.mu.Lock()
			if now.Sub(last) > 2*period {
				p.late++
			}
			// The ring ran dry since the last tick: the machine is under pressure, so keep
			// more audio ahead of the device. Up to the ring less one period. Not in the
			// first second, which is the devices settling and says nothing about the machine.
			if u := p.playback.Underruns(); u > lastUnderruns {
				lastUnderruns = u
				if step := SampleRate * 20 / 1000; now.Sub(started) > time.Second && p.ahead+step <= ringFrames-SampleRate*PeriodMs/1000 {
					p.ahead += step
				}
			}
			ahead := p.ahead
			p.mu.Unlock()
			last = now
			if n := p.capture.read(inBuf); n > 0 {
				p.mu.Lock()
				p.capFrames += n
				p.capRMS = RMS(inBuf[:n])
				p.mu.Unlock()
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

// Late is how many ticks came more than a period late; AheadMs the current headroom.
func (p *Pump) Late() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.late
}

func (p *Pump) AheadMs() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.ahead * 1000 / SampleRate
}

// Priority says what the pump's thread got: "audio", or "normal (why)".
func (p *Pump) Priority() string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.priority
}

// Describe says which devices are open, what they are really running at, and what the
// pump's thread got. The names are in it because an interface with several buses — a
// stream mix, a raw microphone, a chat bus — sounds like a different microphone depending
// on which one is open, and two machines on the same hardware can easily be on different
// ones without anybody noticing.
func (p *Pump) Describe() string {
	return fmt.Sprintf("%s; in %q, out %q; capture %s, playback %s, ring %d ms, pump every %d ms, ahead %d ms, thread priority %s",
		p.path, deviceName(p.in), deviceName(p.out), p.capture.describe(), p.playback.describe(), RingMs, PumpMs, p.AheadMs(), p.Priority())
}

func deviceName(d *Device) string {
	if d == nil {
		return "system default"
	}
	return d.Name
}

func (st *Stream) describe() string {
	if st.rs != nil {
		return fmt.Sprintf("%d Hz (converted to %d here)", st.rate, SampleRate)
	}
	return fmt.Sprintf("%d Hz", st.Rate())
}

// Path says which way the devices are open.
func (p *Pump) Path() string { return p.path }

// Captured says what the microphone side delivered since the last call: frames and the
// last RMS. Frames per second at 48 kHz should read 48000; zero means a dead capture.
func (p *Pump) Captured() (frames int, rms float64) {
	p.mu.Lock()
	defer p.mu.Unlock()
	frames, rms = p.capFrames, p.capRMS
	p.capFrames = 0
	return
}

// Reopens is how often a device change made the pump open its devices again.
func (p *Pump) Reopens() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.reopens
}

// Underruns is how often the playback callback found the ring empty, plus capture overruns.
func (p *Pump) Underruns() int { return p.playback.Underruns() + p.capture.Underruns() }

func (p *Pump) Close() {
	close(p.stop)
	<-p.done
	p.closeStreams()
	C.om_unwatch()
}
