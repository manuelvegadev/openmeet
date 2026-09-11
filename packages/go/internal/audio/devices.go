package audio

import (
	"fmt"
	"strings"
	"unsafe"

	"github.com/gen2brain/malgo"
)

// Everything crosses this package at 48 kHz: capture as mono int16 in 20 ms frames (the
// Opus frame we send), playback as interleaved stereo int16.
const (
	SampleRate  = 48000
	FrameMs     = 20
	FrameLen    = SampleRate * FrameMs / 1000 // 960 samples per channel
	OutChannels = 2
)

// Engine owns the miniaudio context, which is the one native dependency for audio I/O on
// every platform (CoreAudio, WASAPI, ALSA/PulseAudio) and is statically linked.
type Engine struct {
	ctx *malgo.AllocatedContext
}

type Device struct {
	Name    string
	ID      malgo.DeviceID
	Default bool
}

func NewEngine() (*Engine, error) {
	ctx, err := malgo.InitContext(nil, malgo.ContextConfig{}, nil)
	if err != nil {
		return nil, fmt.Errorf("audio context: %w", err)
	}
	return &Engine{ctx: ctx}, nil
}

func (e *Engine) Close() {
	_ = e.ctx.Uninit()
	e.ctx.Free()
}

func (e *Engine) list(kind malgo.DeviceType) ([]Device, error) {
	infos, err := e.ctx.Devices(kind)
	if err != nil {
		return nil, err
	}
	out := make([]Device, 0, len(infos))
	for _, i := range infos {
		out = append(out, Device{Name: i.Name(), ID: i.ID, Default: i.IsDefault != 0})
	}
	return out, nil
}

func (e *Engine) Inputs() ([]Device, error)  { return e.list(malgo.Capture) }
func (e *Engine) Outputs() ([]Device, error) { return e.list(malgo.Playback) }

// Find picks a device by a case-insensitive substring of its name, or the default when
// name is empty. Returns nil for the default so the driver chooses.
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

// Stream is one open device, capture or playback.
type Stream struct {
	dev *malgo.Device
}

func (s *Stream) Close() {
	s.dev.Uninit()
}

// OpenCapture opens a mono 48 kHz capture stream; onPCM gets each driver period as int16.
// The callback runs on the audio thread: do not block in it.
func (e *Engine) OpenCapture(dev *Device, onPCM func(pcm []int16)) (*Stream, error) {
	cfg := malgo.DefaultDeviceConfig(malgo.Capture)
	cfg.Capture.Format = malgo.FormatS16
	cfg.Capture.Channels = 1
	cfg.SampleRate = SampleRate
	cfg.PeriodSizeInMilliseconds = 10
	if dev != nil {
		id := dev.ID
		cfg.Capture.DeviceID = id.Pointer()
	}
	callbacks := malgo.DeviceCallbacks{
		Data: func(_, in []byte, frames uint32) {
			if frames == 0 {
				return
			}
			onPCM(unsafe.Slice((*int16)(unsafe.Pointer(&in[0])), int(frames)))
		},
	}
	d, err := malgo.InitDevice(e.ctx.Context, cfg, callbacks)
	if err != nil {
		return nil, fmt.Errorf("capture device: %w", err)
	}
	if err := d.Start(); err != nil {
		d.Uninit()
		return nil, fmt.Errorf("capture start: %w", err)
	}
	return &Stream{dev: d}, nil
}

// OpenPlayback opens a stereo 48 kHz playback stream; fill is asked for interleaved
// stereo int16 for each driver period. Same rule: it runs on the audio thread.
func (e *Engine) OpenPlayback(dev *Device, fill func(out []int16)) (*Stream, error) {
	cfg := malgo.DefaultDeviceConfig(malgo.Playback)
	cfg.Playback.Format = malgo.FormatS16
	cfg.Playback.Channels = OutChannels
	cfg.SampleRate = SampleRate
	cfg.PeriodSizeInMilliseconds = 10
	if dev != nil {
		id := dev.ID
		cfg.Playback.DeviceID = id.Pointer()
	}
	callbacks := malgo.DeviceCallbacks{
		Data: func(out, _ []byte, frames uint32) {
			if frames == 0 {
				return
			}
			fill(unsafe.Slice((*int16)(unsafe.Pointer(&out[0])), int(frames)*OutChannels))
		},
	}
	d, err := malgo.InitDevice(e.ctx.Context, cfg, callbacks)
	if err != nil {
		return nil, fmt.Errorf("playback device: %w", err)
	}
	if err := d.Start(); err != nil {
		d.Uninit()
		return nil, fmt.Errorf("playback start: %w", err)
	}
	return &Stream{dev: d}, nil
}
