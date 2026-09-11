package audio

import (
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"gopkg.in/hraban/opus.v2"
)

// Packet is one encoded Opus frame, stamped on the capture clock: Timestamp is in samples
// since the stream started and keeps advancing while the gate is shut, so a peer's jitter
// buffer sees silence as time that passed, not as packets that vanished. Marker is set on
// the first packet of a talkspurt.
type Packet struct {
	Payload   []byte
	Timestamp uint32
	Marker    bool
}

// Capture turns the microphone into Opus packets: re-chunks driver periods into 20 ms
// frames, runs the voice gate, encodes what passes — once, whatever the room size — and
// hands the packets to Send. Mute holds the gate shut without feeding it.
//
// The audio callback only copies. A callback from a C thread enters Go through cgo on an
// extra M every time, and the encoder and the UDP write done from there measured at half
// the process's CPU; on a goroutine of our own they are a fraction of that. The channel is
// deep enough for the goroutine to be late by a period or two and shallow enough that a
// stalled one drops frames rather than building latency.
type Capture struct {
	send       func(Packet)
	onSpeaking func(bool)
	gate       *VoiceGate
	gateOn     bool
	enc        *opus.Encoder
	muted      atomic.Bool
	acc        []int16
	frames     uint32 // capture clock, in frames
	speaking   bool
	afterGap   bool
	out        []byte
	start      time.Time
	frames_    chan []int16
	pool       sync.Pool
	Late       int
}

type CaptureOptions struct {
	// Opus bitrate in bps for the one encoder. 64 kbps mono is transparent for speech.
	Bitrate int
	// Transmit only while the gate is open. Off sends every frame.
	VoiceGate bool
}

func NewCapture(opts CaptureOptions, send func(Packet), onSpeaking func(bool)) (*Capture, error) {
	enc, err := opus.NewEncoder(SampleRate, 1, opus.AppVoIP)
	if err != nil {
		return nil, fmt.Errorf("opus encoder: %w", err)
	}
	if opts.Bitrate > 0 {
		if err := enc.SetBitrate(opts.Bitrate); err != nil {
			return nil, err
		}
	}
	// FEC: the encoder embeds a low-rate copy of the previous frame, so a peer that loses
	// one packet reconstructs it from the next instead of concealing. Cheap at these rates.
	_ = enc.SetInBandFEC(true)
	_ = enc.SetPacketLossPerc(10)
	c := &Capture{
		send:       send,
		onSpeaking: onSpeaking,
		gate:       NewVoiceGate(FrameLen),
		gateOn:     opts.VoiceGate,
		enc:        enc,
		acc:        make([]int16, 0, FrameLen*2),
		out:        make([]byte, 1500),
		afterGap:   true,
		start:      time.Now(),
		frames_:    make(chan []int16, 8),
	}
	c.pool.New = func() any { return make([]int16, FrameLen) }
	go c.loop()
	return c, nil
}

func (c *Capture) loop() {
	for frame := range c.frames_ {
		c.frame(frame)
		c.pool.Put(frame)
	}
}

func (c *Capture) SetMuted(m bool) { c.muted.Store(m) }
func (c *Capture) Muted() bool     { return c.muted.Load() }

// OnPCM takes a driver period of mono samples. Runs on the audio thread: it copies into a
// frame and hands it over, nothing more.
func (c *Capture) OnPCM(pcm []int16) {
	c.acc = append(c.acc, pcm...)
	for len(c.acc) >= FrameLen {
		frame := c.pool.Get().([]int16)
		copy(frame, c.acc[:FrameLen])
		c.acc = append(c.acc[:0], c.acc[FrameLen:]...)
		select {
		case c.frames_ <- frame:
		default:
			c.pool.Put(frame)
			c.Late++
		}
	}
}

func (c *Capture) frame(frame []int16) {
	c.frames++
	if c.muted.Load() {
		if c.gate.IsOpen() {
			c.gate.Close()
		}
		c.setSpeaking(false)
		c.afterGap = true
		return
	}
	rms := RMS(frame)
	var outgoing [][]int16
	if c.gateOn {
		outgoing = c.gate.Step(frame, rms, float64(time.Since(c.start).Milliseconds()))
	} else {
		outgoing = [][]int16{frame}
	}
	for i, f := range outgoing {
		age := uint32(len(outgoing) - 1 - i)
		n, err := c.enc.Encode(f, c.out)
		if err != nil {
			continue
		}
		payload := make([]byte, n)
		copy(payload, c.out[:n])
		c.send(Packet{Payload: payload, Timestamp: (c.frames - 1 - age) * FrameLen, Marker: c.afterGap})
		c.afterGap = false
	}
	if len(outgoing) == 0 {
		c.afterGap = true
	}
	if c.gateOn {
		c.setSpeaking(c.gate.IsOpen())
	} else {
		c.setSpeaking(rms > SpeakingRMSThreshold)
	}
}

func (c *Capture) setSpeaking(on bool) {
	if on == c.speaking {
		return
	}
	c.speaking = on
	if c.onSpeaking != nil {
		c.onSpeaking(on)
	}
}
