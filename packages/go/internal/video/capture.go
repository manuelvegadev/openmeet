package video

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"os/exec"
	"runtime"
	"strconv"
	"sync"
	"time"

	"github.com/pion/webrtc/v4/pkg/media"
)

// What a share goes out as. The screen keeps its own aspect ratio with the short side
// capped at 1080 and the long side at 3840 (gotcha 17); the camera at 720 tall. The
// encoder gets a keyframe every second so a newcomer waits at most that long: pion has
// no way to ask ffmpeg for one on a PLI.
const (
	ScreenFPS      = 30
	ScreenShort    = 1080
	ScreenLong     = 3840
	CameraHeight   = 720
	CameraFPS      = 30
	keyframeEvery  = 1 * time.Second
	silenceTimeout = 8 * time.Second
)

// Kind is which of the two video tracks a stream rides.
type Kind string

const (
	Webcam Kind = "webcam"
	Screen Kind = "screen"
)

// Sample is one H.264 access unit, Annex-B, and how long it lasts.
type Sample = media.Sample

// Capture is one ffmpeg run: a device in, H.264 access units out, each handed to Emit.
type Capture struct {
	Kind    Kind
	Emit    func(Sample)
	OnEnded func(reason string)
	Log     func(format string, args ...any)

	cmd     *exec.Cmd
	mu      sync.Mutex
	stopped bool
	frames  int64
	lastAt  time.Time
	done    chan struct{}
}

// outputSize is the share's shape: the screen's own aspect, short side capped at 1080,
// long side at 3840, both even, never enlarged (gotcha 17). Zero when the size is unknown.
func outputSize(w, h int, short, long int) (int, int) {
	if w <= 0 || h <= 0 {
		return 0, 0
	}
	fw, fh := float64(w), float64(h)
	s, l := fw, fh
	if s > l {
		s, l = l, s
	}
	scale := 1.0
	if s > float64(short) {
		scale = float64(short) / s
	}
	if l*scale > float64(long) {
		scale = float64(long) / l
	}
	ow, oh := int(fw*scale+0.5)&^1, int(fh*scale+0.5)&^1
	return ow, oh
}

// screenArgs is ffmpeg's input and filter for a screen, and where the pixels go on the
// way to the encoder — which is the whole cost of a share:
//
//   - macOS: avfoundation hands uyvy422 frames; they go up to the GPU as they are and
//     VideoToolbox scales them there (`scale_vt`), so the CPU never touches a pixel.
//     Measured on the M4 Pro at 3096x1296 → 2580x1080p30: 33% of a core against 103–133%
//     for any chain that scales or converts on the CPU. `-r` because avfoundation ignores
//     `-framerate` for screens (gotcha 16).
//   - Windows: ddagrab keeps frames in D3D11 with `dup_frames=false` so a still desktop
//     costs nothing (gotcha 23); NVENC takes them as they are, unscaled, the other encoders
//     need them downloaded. gdigrab is the fallback when DDA has no output (an RDP session).
func screenArgs(d Device, fallback bool) []string {
	fps := strconv.Itoa(ScreenFPS)
	ow, oh := outputSize(d.Width, d.Height, ScreenShort, ScreenLong)
	switch runtime.GOOS {
	case "darwin":
		args := []string{"-f", "avfoundation", "-capture_cursor", "1", "-framerate", fps, "-pixel_format", "uyvy422", "-i", d.ID + ":none", "-r", fps,
			"-init_hw_device", "videotoolbox=vt", "-filter_hw_device", "vt"}
		if ow > 0 && (ow != d.Width || oh != d.Height) {
			return append(args, "-vf", fmt.Sprintf("hwupload,scale_vt=w=%d:h=%d", ow, oh))
		}
		if ow == 0 {
			// Size unknown: cap the short side on the GPU and keep the aspect.
			return append(args, "-vf", fmt.Sprintf("hwupload,scale_vt=w=-2:h=%d", ScreenShort))
		}
		return append(args, "-vf", "hwupload")
	case "windows":
		if !fallback {
			args := []string{"-f", "lavfi", "-i", fmt.Sprintf("ddagrab=output_idx=%s:framerate=%d:dup_frames=false", d.ID, ScreenFPS)}
			if Encoder() == "h264_nvenc" {
				// The D3D11 frames go to NVENC as they are: no filter can scale them there
				// (scale_cuda wants CUDA frames, hwmap to CUDA is ENOSYS — gotcha 28), so the
				// screen goes out at its own size — an ultrawide as 3440x1440 — and only a
				// panel past 4K is downloaded and scaled on the CPU.
				if d.Width <= 3840 && d.Height <= 2160 {
					return args
				}
				return append(args, "-vf", "hwdownload,format=bgra"+cpuScale(ow, oh))
			}
			args = append(args, "-vf", "hwdownload,format=bgra"+cpuScale(ow, oh))
			return args
		}
		return []string{"-f", "gdigrab", "-framerate", fps, "-i", "desktop", "-vf", "format=bgra" + cpuScale(ow, oh)}
	default:
		return []string{"-f", "x11grab", "-framerate", fps, "-i", ":0.0", "-vf", "format=bgra" + cpuScale(ow, oh)}
	}
}

func cpuScale(ow, oh int) string {
	if ow > 0 {
		return fmt.Sprintf(",scale=%d:%d:flags=fast_bilinear", ow, oh)
	}
	return fmt.Sprintf(",scale=-2:'min(ih,%d)':flags=fast_bilinear", ScreenShort)
}

// cameraArgs: the camera opened at whatever it offers, never pinned to a size (gotcha 12),
// paced to CameraFPS and scaled on the GPU to 720 tall.
func cameraArgs(d Device) []string {
	fps := strconv.Itoa(CameraFPS)
	return []string{"-f", "avfoundation", "-framerate", fps, "-pixel_format", "uyvy422", "-i", d.ID + ":none",
		"-init_hw_device", "videotoolbox=vt", "-filter_hw_device", "vt",
		"-vf", fmt.Sprintf("fps=%s,hwupload,scale_vt=w=-2:h=%d", fps, CameraHeight)}
}

// encoderArgs: the hardware encoder at a constant-ish rate, no B-frames (latency), a
// keyframe every second, baseline-compatible output as an Annex-B stream with access-unit
// delimiters so the reader can split it without parsing slices.
func encoderArgs(kbps int, fps int) []string {
	enc := Encoder()
	args := []string{"-c:v", enc, "-b:v", fmt.Sprintf("%dk", kbps), "-maxrate", fmt.Sprintf("%dk", kbps), "-bufsize", fmt.Sprintf("%dk", kbps/2),
		"-g", strconv.Itoa(fps * int(keyframeEvery/time.Second)), "-bf", "0"}
	switch enc {
	case "h264_videotoolbox":
		args = append(args, "-realtime", "1", "-profile:v", "main", "-allow_sw", "1")
	case "h264_nvenc":
		args = append(args, "-preset", "p1", "-tune", "ll", "-rc", "cbr", "-profile:v", "main", "-zerolatency", "1")
	case "h264_amf":
		args = append(args, "-usage", "ultralowlatency", "-profile:v", "main")
	case "h264_qsv":
		args = append(args, "-preset", "veryfast", "-profile:v", "main")
	case "libx264":
		args = append(args, "-preset", "veryfast", "-tune", "zerolatency", "-profile:v", "main", "-pix_fmt", "yuv420p")
	}
	return append(args, "-bsf:v", "h264_metadata=aud=insert", "-f", "h264", "pipe:1")
}

// Start runs the capture. kbps is the whole share's budget, the same to every peer.
func Start(kind Kind, d Device, kbps int, emit func(Sample), onEnded func(string), log func(string, ...any)) (*Capture, error) {
	if Ffmpeg() == "" || Encoder() == "" {
		return nil, fmt.Errorf("ffmpeg with an H.264 encoder not found")
	}
	c := &Capture{Kind: kind, Emit: emit, OnEnded: onEnded, Log: log, done: make(chan struct{})}
	fps := ScreenFPS
	var in []string
	if kind == Screen {
		in = screenArgs(d, false)
	} else {
		in = cameraArgs(d)
		fps = CameraFPS
	}
	args := append([]string{"-hide_banner", "-loglevel", "error", "-nostdin", "-fflags", "nobuffer", "-flags", "low_delay"}, in...)
	args = append(args, encoderArgs(kbps, fps)...)
	if err := c.run(args, fps, kind == Screen && runtime.GOOS == "windows", d, kbps); err != nil {
		return nil, err
	}
	return c, nil
}

func (c *Capture) run(args []string, fps int, canFallBack bool, d Device, kbps int) error {
	cmd := exec.Command(Ffmpeg(), args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	c.cmd = cmd
	c.lastAt = time.Now()
	if c.Log != nil {
		c.Log("video: %s %s via %s at %d kbps", c.Kind, d.Name, Encoder(), kbps)
	}
	go c.read(out, fps)
	go func() {
		err := cmd.Wait()
		c.mu.Lock()
		stopped := c.stopped
		frames := c.frames
		c.mu.Unlock()
		close(c.done)
		if stopped {
			return
		}
		reason := "ffmpeg exited"
		if err != nil {
			reason = fmt.Sprintf("ffmpeg exited: %v", err)
		}
		if msg := bytes.TrimSpace(stderr.Bytes()); len(msg) > 0 {
			reason += " — " + lastLine(string(msg))
		}
		if frames == 0 && canFallBack {
			// The desktop duplication path has no output here (an RDP session, a headless
			// desktop); gdigrab captures what is on screen anyway.
			if c.Log != nil {
				c.Log("video: %s; trying gdigrab", reason)
			}
			c.done = make(chan struct{})
			args2 := append([]string{"-hide_banner", "-loglevel", "error", "-nostdin", "-fflags", "nobuffer", "-flags", "low_delay"}, screenArgs(d, true)...)
			args2 = append(args2, encoderArgs(kbps, fps)...)
			if c.run(args2, fps, false, d, kbps) == nil {
				return
			}
		}
		if c.OnEnded != nil {
			c.OnEnded(reason)
		}
	}()
	return nil
}

// read splits the Annex-B stream at access-unit delimiters and hands each unit on with
// its duration. It also watches for silence: a capture that runs and never writes a byte
// is the failure mode of a missing screen-recording permission (gotcha 16).
func (c *Capture) read(r io.Reader, fps int) {
	br := bufio.NewReaderSize(r, 1<<20)
	dur := time.Second / time.Duration(fps)
	var au []byte
	var nal []byte
	start := []byte{0, 0, 0, 1}
	watchdog := time.AfterFunc(silenceTimeout, func() {
		c.mu.Lock()
		frames := c.frames
		c.mu.Unlock()
		if frames == 0 {
			c.Stop()
			if c.OnEnded != nil {
				c.OnEnded("no frames in 8 s: no screen-recording permission for this terminal, or the capture is wedged (gotcha 16)")
			}
		}
	})
	defer watchdog.Stop()
	flush := func() {
		if len(au) == 0 {
			return
		}
		c.mu.Lock()
		c.frames++
		c.lastAt = time.Now()
		c.mu.Unlock()
		c.Emit(Sample{Data: au, Duration: dur})
		au = nil
	}
	buf := make([]byte, 64<<10)
	for {
		n, err := br.Read(buf)
		if n > 0 {
			nal = append(nal, buf[:n]...)
			// Cut at every start code; a NAL of type 9 (AUD) opens the next access unit.
			for {
				i := bytes.Index(nal[1:], start)
				if i < 0 {
					break
				}
				unit := nal[:i+1]
				nal = nal[i+1:]
				if len(unit) >= 5 && unit[4]&0x1f == 9 {
					flush()
				}
				au = append(au, unit...)
			}
		}
		if err != nil {
			au = append(au, nal...)
			flush()
			return
		}
	}
}

// Frames is how many access units went out.
func (c *Capture) Frames() int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.frames
}

// Stop ends the capture and waits for ffmpeg to be gone: the device is held until then.
func (c *Capture) Stop() {
	c.mu.Lock()
	if c.stopped {
		c.mu.Unlock()
		return
	}
	c.stopped = true
	cmd := c.cmd
	done := c.done
	c.mu.Unlock()
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Signal(interruptSignal())
		select {
		case <-done:
		case <-time.After(1500 * time.Millisecond):
			_ = cmd.Process.Kill()
			<-done
		}
	}
}

func lastLine(s string) string {
	lines := bytes.Split([]byte(s), []byte("\n"))
	return string(lines[len(lines)-1])
}
