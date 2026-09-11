// Package engine is the room session without the interface: signaling, the mesh, the audio
// pump, the stats, and the events the interface draws from. The Node client kept this in a
// second process; here it is goroutines, and nothing in it touches the screen.
package engine

import (
	"context"
	"fmt"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/pion/rtp"

	"github.com/manuelvegadev/openmeet/packages/go/internal/audio"
	"github.com/manuelvegadev/openmeet/packages/go/internal/rtc"
	"github.com/manuelvegadev/openmeet/packages/go/internal/signal"
	"github.com/manuelvegadev/openmeet/packages/go/internal/tui"
)

type Options struct {
	ServerURL string
	Room      string
	Name      string
	Color     string
	Input     *audio.Device
	Output    *audio.Device
	VoiceGate bool
	Bitrate   int // Opus bps
	Complex   int
	Debug     bool
}

type peerInfo struct {
	p        signal.Participant
	speaking bool
	muted    bool
	camOn    bool
	screen   bool
	volume   float64
	state    string
	recvKbps int
	latency  int
	bytes    int64
	prevRTT  int
}

// Engine is one room session. Events go to Emit; Close leaves.
type Engine struct {
	opts   Options
	audio  *audio.Engine
	Emit   func(msg interface{})
	sig    *signal.Client
	peers  *rtc.Manager
	play   *audio.Playout
	cap    *audio.Capture
	pump   *audio.Pump
	myID   string
	joined time.Time

	mu        sync.Mutex
	people    map[string]*peerInfo
	connected bool
	errMsg    string
	debug     bool
	stats     *tui.Stats
	sentBytes int64
	done      chan struct{}
	once      sync.Once
}

func New(a *audio.Engine, opts Options, emit func(interface{})) *Engine {
	return &Engine{opts: opts, audio: a, Emit: emit, people: map[string]*peerInfo{}, done: make(chan struct{}), debug: opts.Debug}
}

func (e *Engine) logf(format string, args ...interface{}) {
	line := fmt.Sprintf(format, args...)
	e.Emit(tui.DebugLine{At: time.Now(), Kind: tui.KindInfo, Text: line})
}

func (e *Engine) notice(kind tui.EntryKind, who, color, text string) {
	e.Emit(tui.Line{At: time.Now(), Kind: kind, Who: who, Color: color, Text: text})
}

// Start connects, joins, and opens the devices. Errors before the room is joined come back;
// later ones become the room's error line.
func (e *Engine) Start() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	sig, err := signal.Dial(ctx, e.opts.ServerURL)
	cancel()
	if err != nil {
		return err
	}
	e.sig = sig
	e.play = audio.NewPlayout(func(id string, on bool) {
		e.mu.Lock()
		if p := e.people[id]; p != nil {
			p.speaking = on
		}
		e.mu.Unlock()
		e.snapshot()
	})
	e.peers, err = rtc.NewManager(rtc.Options{
		Send: sig.Send,
		OnAudio: func(peerID string, pkt *rtp.Packet) {
			e.mu.Lock()
			if p := e.people[peerID]; p != nil {
				p.bytes += int64(len(pkt.Payload)) + 12
			}
			e.mu.Unlock()
			e.play.Push(peerID, pkt)
		},
		OnState: func(peerID, state string) {
			e.mu.Lock()
			if p := e.people[peerID]; p != nil {
				p.state = state
			}
			e.mu.Unlock()
			e.snapshot()
		},
		Log: e.logf,
	})
	if err != nil {
		return err
	}
	e.cap, err = audio.NewCapture(audio.CaptureOptions{Bitrate: e.opts.Bitrate, Complexity: e.opts.Complex, VoiceGate: e.opts.VoiceGate},
		func(p audio.Packet) {
			e.mu.Lock()
			e.sentBytes += int64(len(p.Payload)) + 12
			e.mu.Unlock()
			_ = e.peers.Write(p)
		},
		func(on bool) { e.setMySpeaking(on) })
	if err != nil {
		return err
	}
	e.pump, err = e.audio.StartPump(e.opts.Input, e.opts.Output, e.cap.OnPCM, e.play.Fill)
	if err != nil {
		return err
	}
	// The call outranks whatever else the machine is doing: the process class here, the
	// pump's own thread inside audio.Pump. Neither needs elevation.
	if audio.NoPriority {
		e.logf("process priority: left alone (asked)")
	} else if err := audio.RaiseProcessPriority(); err != nil {
		e.logf("process priority: not raised (%v)", err)
	} else if runtime.GOOS == "windows" {
		e.logf("process priority: high")
	}
	go e.loop()
	go e.statsLoop()
	return sig.Send(signal.Message{Type: "join-room", RoomID: e.opts.Room, Username: e.opts.Name, Color: e.opts.Color})
}

var mySpeaking bool

func (e *Engine) setMySpeaking(on bool) {
	e.mu.Lock()
	changed := mySpeaking != on
	mySpeaking = on
	e.mu.Unlock()
	if changed {
		e.snapshot()
	}
}

func (e *Engine) sendMute() {
	m := e.cap.Muted()
	noCam := true
	_ = e.sig.Send(signal.Message{Type: "mute-state", FromID: e.myID, IsAudioMuted: &m, IsVideoMuted: &noCam})
}

func (e *Engine) loop() {
	for msg := range e.sig.Incoming {
		switch msg.Type {
		case "room-joined":
			e.myID = msg.YourID
			e.peers.SetMyID(e.myID)
			e.mu.Lock()
			e.connected = true
			e.joined = time.Now()
			for _, p := range msg.Participants {
				e.people[p.ID] = &peerInfo{p: p, volume: 1, recvKbps: -1, latency: -1}
			}
			e.mu.Unlock()
			e.notice(tui.KindJoin, e.opts.Name, e.opts.Color, "joined the room")
			for _, p := range msg.Participants {
				_ = e.play.AddPeer(p.ID)
				e.peers.Offer(p.ID)
				e.notice(tui.KindJoin, p.Username, p.Color, "is in the room")
			}
			e.sendMute()
			e.snapshot()
		case "participant-joined":
			if p := msg.Participant; p != nil {
				e.mu.Lock()
				e.people[p.ID] = &peerInfo{p: *p, volume: 1, recvKbps: -1, latency: -1}
				e.mu.Unlock()
				_ = e.play.AddPeer(p.ID)
				e.sendMute()
				e.notice(tui.KindJoin, p.Username, p.Color, "joined")
				e.snapshot()
			}
		case "participant-left":
			e.mu.Lock()
			p := e.people[msg.ParticipantID]
			delete(e.people, msg.ParticipantID)
			e.mu.Unlock()
			e.play.RemovePeer(msg.ParticipantID)
			e.peers.Remove(msg.ParticipantID)
			if p != nil {
				e.notice(tui.KindLeave, p.p.Username, p.p.Color, "left")
			}
			e.snapshot()
		case "offer":
			e.peers.HandleOffer(msg.FromID, msg.SDP)
		case "answer":
			e.peers.HandleAnswer(msg.FromID, msg.SDP)
		case "ice-candidate":
			e.peers.HandleCandidate(msg.FromID, msg.Candidate)
		case "mute-state":
			e.mu.Lock()
			p := e.people[msg.FromID]
			var was, now bool
			if p != nil && msg.IsAudioMuted != nil {
				was, now = p.muted, *msg.IsAudioMuted
				p.muted = now
				if msg.IsVideoMuted != nil {
					p.camOn = !*msg.IsVideoMuted
				} else {
					p.camOn = false
				}
			}
			e.mu.Unlock()
			if p != nil && was != now {
				what := "unmuted"
				if now {
					what = "muted"
				}
				e.notice(tui.KindMute, p.p.Username, p.p.Color, what)
			}
			e.snapshot()
		case "screen-share-state":
			e.mu.Lock()
			if p := e.people[msg.FromID]; p != nil && msg.IsScreenSharing != nil {
				p.screen = *msg.IsScreenSharing
			}
			e.mu.Unlock()
			e.snapshot()
		case "chat-broadcast":
			if c := msg.ChatMessage; c != nil {
				e.Emit(tui.Line{At: time.UnixMilli(c.Timestamp), Kind: tui.KindMessage, Who: c.Username, Color: c.Color, Text: c.Content})
			}
		case "error":
			e.mu.Lock()
			e.errMsg = msg.ErrorMessage
			e.mu.Unlock()
			e.snapshot()
		}
	}
	e.mu.Lock()
	e.connected = false
	e.mu.Unlock()
	e.snapshot()
	e.Emit(tui.Left{Reason: "connection closed"})
}

// snapshot sends the room's state as the interface draws it.
func (e *Engine) snapshot() {
	e.mu.Lock()
	ids := make([]string, 0, len(e.people))
	for id := range e.people {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return e.people[ids[i]].p.JoinedAt < e.people[ids[j]].p.JoinedAt })
	peers := make([]tui.Peer, 0, len(ids))
	for _, id := range ids {
		p := e.people[id]
		peers = append(peers, tui.Peer{
			ID: id, Name: p.p.Username, Color: p.p.Color, Speaking: p.speaking, Muted: p.muted,
			CamOn: p.camOn, Screen: p.screen, Volume: p.volume, RecvKbps: p.recvKbps, LatencyMs: p.latency,
		})
	}
	snap := tui.Snapshot{
		Connected: e.connected, JoinedAt: e.joined, Error: e.errMsg, Debug: e.debug, Stats: e.stats,
		Me:    tui.Peer{Name: e.opts.Name, Color: e.opts.Color, Speaking: mySpeaking, Muted: e.cap != nil && e.cap.Muted()},
		Peers: peers,
	}
	e.mu.Unlock()
	e.Emit(snap)
}

// statsLoop computes what the header and the participant rows show, every two seconds.
func (e *Engine) statsLoop() {
	t := time.NewTicker(2 * time.Second)
	defer t.Stop()
	var prevSent int64
	prevRecv := map[string]int64{}
	prevLoss := map[string][2]int{}
	last := time.Now()
	described := false
	for {
		select {
		case <-e.done:
			return
		case now := <-t.C:
			dt := now.Sub(last).Seconds()
			last = now
			if !described {
				described = true
				e.logf("audio: %s", e.pump.Describe())
			}
			if e.debug {
				e.logf("pump: %d late ticks, %d ms ahead, %d device underruns", e.pump.Late(), e.pump.AheadMs(), e.pump.Underruns())
			}
			rtts := e.peers.RTTs()
			e.mu.Lock()
			sent := e.sentBytes
			sendKbps := int(float64(sent-prevSent) * 8 / dt / 1000)
			prevSent = sent
			var recvTotal int64
			lost, total := 0, 0
			for id, p := range e.people {
				d := p.bytes - prevRecv[id]
				prevRecv[id] = p.bytes
				recvTotal += d
				p.recvKbps = int(float64(d) * 8 / dt / 1000)
				st := e.play.Stats(id)
				pl := prevLoss[id]
				lost += (st.Concealed + st.Recovered) - pl[0]
				total += (st.Received + st.Concealed + st.Recovered) - pl[1]
				prevLoss[id] = [2]int{st.Concealed + st.Recovered, st.Received + st.Concealed + st.Recovered}
				if rtt, ok := rtts[id]; ok {
					p.prevRTT = rtt
				}
				if p.prevRTT > 0 || st.Received > 0 {
					jb := st.JitterMs * 2
					if jb < 20 {
						jb = 20
					}
					p.latency = int(float64(p.prevRTT)/2 + jb + 20 + 0.5)
				}
			}
			rttSum, rttN := 0, 0
			for _, p := range e.people {
				if p.prevRTT > 0 {
					rttSum += p.prevRTT
					rttN++
				}
			}
			rtt := 0
			if rttN > 0 {
				rtt = rttSum / rttN
			}
			loss := 0.0
			if total > 0 {
				loss = float64(lost) / float64(total) * 100
				loss = float64(int(loss*10+0.5)) / 10
			}
			e.stats = &tui.Stats{SendKbps: sendKbps, RecvKbps: int(float64(recvTotal) * 8 / dt / 1000), RTTMs: rtt, LossPercent: loss}
			e.mu.Unlock()
			e.snapshot()
		}
	}
}

// ── actions ──────────────────────────────────────────────────────────────────

func (e *Engine) ToggleMute() {
	e.cap.SetMuted(!e.cap.Muted())
	e.sendMute()
	what := "unmuted"
	if e.cap.Muted() {
		what = "muted"
	}
	e.notice(tui.KindMute, e.opts.Name, e.opts.Color, what)
	e.snapshot()
}

func (e *Engine) SendChat(text string) {
	_ = e.sig.Send(signal.Message{
		Type: "chat-message", ID: fmt.Sprintf("%d", time.Now().UnixNano()), RoomID: e.opts.Room,
		Username: e.opts.Name, Content: text, Timestamp: time.Now().UnixMilli(),
	})
}

func (e *Engine) SetVolume(peerID string, v float64) {
	if v < 0 {
		v = 0
	}
	if v > 1 {
		v = 1
	}
	e.play.SetVolume(peerID, v)
	e.mu.Lock()
	if p := e.people[peerID]; p != nil {
		p.volume = v
	}
	e.mu.Unlock()
	e.snapshot()
}

func (e *Engine) ToggleDebug() {
	e.mu.Lock()
	e.debug = !e.debug
	e.mu.Unlock()
	e.snapshot()
}

// UpdateDevices reopens the pump on other devices, mid-call.
func (e *Engine) UpdateDevices(in, out *audio.Device) error {
	e.pump.Close()
	pump, err := e.audio.StartPump(in, out, e.cap.OnPCM, e.play.Fill)
	if err != nil {
		return err
	}
	e.pump = pump
	e.notice(tui.KindInfo, "", "", "Audio devices changed: "+deviceName(in)+" → "+deviceName(out))
	return nil
}

func deviceName(d *audio.Device) string {
	if d == nil {
		return "System Default"
	}
	return d.Name
}

// Close leaves the room and releases everything. Safe to call twice.
func (e *Engine) Close() {
	e.once.Do(func() {
		close(e.done)
		if e.pump != nil {
			e.pump.Close()
		}
		if e.peers != nil {
			e.peers.CloseAll()
		}
		if e.sig != nil {
			e.sig.Close()
		}
	})
}

// Sanitize a peer name for display, like the Node engine's cleanParticipant.
func cleanName(s string) string {
	s = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 || r == '[' || r == ']' {
			return -1
		}
		return r
	}, s)
	return strings.TrimSpace(s)
}
