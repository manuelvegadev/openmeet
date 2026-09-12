package video

import (
	"fmt"
	"io"
	"os/exec"
	"sync"
	"time"

	"github.com/pion/rtp/codecs"
	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media/samplebuilder"
)

// Player is one ffplay window showing one peer's stream: RTP in, access units out to
// ffplay's stdin, which decodes and paints. The stream keeps its own resolution; the
// window is capped at 1280x720 so a 1080p share does not open edge to edge.
type Player struct {
	title string
	cmd   *exec.Cmd
	in    io.WriteCloser
	mu    sync.Mutex
	done  bool
	// Frames written, for the stats line.
	frames int64
}

const (
	windowMaxW = 1280
	windowMaxH = 720
)

func NewPlayer(title string) (*Player, error) {
	if Ffplay() == "" {
		return nil, fmt.Errorf("ffplay not found")
	}
	cmd := exec.Command(Ffplay(), "-hide_banner", "-loglevel", "error", "-nostats",
		"-fflags", "nobuffer", "-flags", "low_delay", "-framedrop", "-probesize", "32", "-analyzeduration", "0",
		"-f", "h264", "-i", "pipe:0", "-window_title", title, "-x", fmt.Sprint(windowMaxW), "-y", fmt.Sprint(windowMaxH))
	in, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	p := &Player{title: title, cmd: cmd, in: in}
	go func() {
		_ = cmd.Wait()
		p.mu.Lock()
		p.done = true
		p.mu.Unlock()
	}()
	return p, nil
}

// Write hands ffplay one access unit; false once the window is gone (closed by hand).
func (p *Player) Write(au []byte) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.done {
		return false
	}
	if _, err := p.in.Write(au); err != nil {
		p.done = true
		return false
	}
	p.frames++
	return true
}

func (p *Player) Closed() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.done
}

func (p *Player) Frames() int64 {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.frames
}

func (p *Player) Close() {
	p.mu.Lock()
	if p.done {
		p.mu.Unlock()
		return
	}
	p.done = true
	p.mu.Unlock()
	_ = p.in.Close()
	if p.cmd.Process != nil {
		_ = p.cmd.Process.Kill()
	}
}

// Receiver follows one remote video track: depacketises into access units and, while a
// window is open, feeds it. The window is the user's to open (w/e) and close.
type Receiver struct {
	PeerName string
	Kind     Kind
	mu       sync.Mutex
	player   *Player
	closed   bool
	// Counters for the debug line.
	packets, frames int64
	OnWindowClosed  func()
	Log             func(format string, args ...any)
}

func NewReceiver(peerName string, kind Kind, track *webrtc.TrackRemote, log func(string, ...any)) *Receiver {
	r := &Receiver{PeerName: peerName, Kind: kind, Log: log}
	go r.run(track)
	return r
}

func (r *Receiver) run(track *webrtc.TrackRemote) {
	// Room for a NACK round trip: a retransmitted packet lands a network RTT after the
	// gap, and a frame given up on before that is a frame lost twice. 400 packets is a few
	// frames at full rate; the time bound is what keeps a still screen (few packets, none
	// late) from holding a sample for ever.
	sb := samplebuilder.New(400, &codecs.H264Packet{}, track.Codec().ClockRate, samplebuilder.WithMaxTimeDelay(200*time.Millisecond))
	for {
		pkt, _, err := track.ReadRTP()
		if err != nil {
			return
		}
		r.mu.Lock()
		r.packets++
		r.mu.Unlock()
		sb.Push(pkt)
		for {
			sample := sb.Pop()
			if sample == nil {
				break
			}
			r.mu.Lock()
			r.frames++
			p := r.player
			r.mu.Unlock()
			if p != nil && !p.Write(sample.Data) {
				r.mu.Lock()
				r.player = nil
				r.mu.Unlock()
				if r.OnWindowClosed != nil {
					r.OnWindowClosed()
				}
			}
		}
	}
}

// Open shows the window. The first picture waits for the next keyframe, at most a second.
func (r *Receiver) Open() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.player != nil && !r.player.Closed() {
		return nil
	}
	p, err := NewPlayer(fmt.Sprintf("%s · %s", r.PeerName, r.Kind))
	if err != nil {
		return err
	}
	r.player = p
	return nil
}

func (r *Receiver) IsOpen() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.player != nil && !r.player.Closed()
}

func (r *Receiver) CloseWindow() {
	r.mu.Lock()
	p := r.player
	r.player = nil
	r.mu.Unlock()
	if p != nil {
		p.Close()
	}
}

// Stats for the debug line: packets and frames since the last call.
func (r *Receiver) Stats() (packets, frames int64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	packets, frames = r.packets, r.frames
	r.packets, r.frames = 0, 0
	return
}

var _ = time.Second
