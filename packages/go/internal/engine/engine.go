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
	"github.com/pion/webrtc/v4"

	"github.com/manuelvegadev/openmeet/packages/go/internal/audio"
	"github.com/manuelvegadev/openmeet/packages/go/internal/rtc"
	"github.com/manuelvegadev/openmeet/packages/go/internal/signal"
	"github.com/manuelvegadev/openmeet/packages/go/internal/tui"
	"github.com/manuelvegadev/openmeet/packages/go/internal/video"
)

type Options struct {
	ServerURL string
	Room      string
	Name      string
	Color     string
	Input     *audio.Device
	Output    *audio.Device
	VoiceGate bool
	Bitrate   int  // Opus bps
	MicLevel  bool // level the microphone ourselves (audio.AutomaticGain)
	Complex   int
	Debug     bool
	// Video: off with a reason the room log states (--no-video, tools missing, OS).
	VideoEnabled     bool
	VideoDisabledWhy string
	WebcamEnabled    bool
	ScreenSendKbps   int
	// A ceiling on everything a share puts on the wire at once; 0 is no ceiling.
	ScreenUploadKbps int
}

type peerInfo struct {
	p        signal.Participant
	speaking bool
	muted    bool
	camOn    bool
	volume   float64
	state    string
	recvKbps int
	latency  int
	bytes    int64
	prevRTT  int
	// Their video, as they say it (signaling) and as we receive it (tracks).
	webcam  *video.Receiver
	screen  *video.Receiver
	sharing bool
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

	// Our shares.
	screenCap *video.Capture
	screenDev *video.Device
	cameraCap *video.Capture
	cameraDev *video.Device
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
		OnVideo: e.onVideoTrack,
		Log:     e.logf,
	})
	if err != nil {
		return err
	}
	e.cap, err = audio.NewCapture(audio.CaptureOptions{Bitrate: e.opts.Bitrate, Complexity: e.opts.Complex, VoiceGate: e.opts.VoiceGate, MicLevel: e.opts.MicLevel},
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
	e.pump.OnEvent = func(msg string) { e.notice(tui.KindInfo, "", "", msg) }
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
	if !e.opts.VideoEnabled && e.opts.VideoDisabledWhy != "" {
		e.notice(tui.KindInfo, "", "", "Video disabled: "+e.opts.VideoDisabledWhy+" — screen sharing and watching peers are off")
	} else if e.opts.VideoEnabled {
		e.logf("video tools: ffmpeg %s, ffplay %s, encoder %s", video.Ffmpeg(), video.Ffplay(), video.Encoder())
	}
	return sig.Send(signal.Message{Type: "join-room", RoomID: e.opts.Room, Username: e.opts.Name, Color: e.opts.Color})
}

// ── video ────────────────────────────────────────────────────────────────────

// onVideoTrack: a peer's camera or screen arrived. A receiver follows it from now on; the
// window is the user's to open (w, e), and closes on its own when a share ends.
func (e *Engine) onVideoTrack(peerID, kind string, track *webrtc.TrackRemote) {
	if !e.opts.VideoEnabled {
		return
	}
	e.mu.Lock()
	p := e.people[peerID]
	if p == nil {
		e.mu.Unlock()
		return
	}
	r := video.NewReceiver(p.p.Username, video.Kind(kind), track, e.logf)
	r.OnWindowClosed = func() { e.snapshot() }
	if kind == "screen" {
		p.screen = r
	} else {
		p.webcam = r
	}
	e.mu.Unlock()
	e.snapshot()
}

// screenBudgetKbps is what each person watching gets. The share is encoded once and the
// same packets go to everyone, so the rate is theirs, not a cake to divide: two people
// watching see the same picture two people would, and what it costs is the upload —
// measured, the sender's CPU does not move with the number of peers, because per peer all
// that happens is SRTP and a sendto.
//
// The exception is a deliberate one: an upload ceiling, off by default. Where it is set and
// the room would go past it, everyone's rate comes down together rather than the link
// failing. It is read when the share starts.
func (e *Engine) screenBudgetKbps() int {
	rate := e.opts.ScreenSendKbps
	if rate <= 0 {
		rate = 2500
	}
	ceiling := e.opts.ScreenUploadKbps
	if ceiling <= 0 {
		return rate
	}
	e.mu.Lock()
	n := len(e.people)
	e.mu.Unlock()
	if n < 1 {
		n = 1
	}
	if share := ceiling / n; share < rate {
		if share < 300 {
			share = 300
		}
		return share
	}
	return rate
}

func (e *Engine) sendScreenState() {
	sharing := e.screenCap != nil
	_ = e.sig.Send(signal.Message{Type: "screen-share-state", FromID: e.myID, IsScreenSharing: &sharing})
}

// StartScreen shares a screen to everyone. One capture, one encoder, every peer.
func (e *Engine) StartScreen(d video.Device) error {
	if !e.opts.VideoEnabled {
		return fmt.Errorf("video is off")
	}
	e.StopScreen()
	c, err := video.Start(video.Screen, d, e.screenBudgetKbps(),
		func(s video.Sample) { _ = e.peers.WriteVideo("screen", s) },
		func(reason string) {
			e.mu.Lock()
			was := e.screenCap != nil
			e.screenCap, e.screenDev = nil, nil
			e.mu.Unlock()
			if was {
				e.notice(tui.KindInfo, "", "", "Screen share ended: "+reason)
				e.sendScreenState()
				e.snapshot()
			}
		}, e.logf)
	if err != nil {
		e.notice(tui.KindInfo, "", "", "Could not share the screen: "+err.Error())
		return err
	}
	e.mu.Lock()
	e.screenCap, e.screenDev = c, &d
	e.mu.Unlock()
	e.notice(tui.KindScreen, e.opts.Name, e.opts.Color, "started screen sharing")
	e.sendScreenState()
	e.snapshot()
	return nil
}

func (e *Engine) StopScreen() {
	e.mu.Lock()
	c := e.screenCap
	e.screenCap, e.screenDev = nil, nil
	e.mu.Unlock()
	if c == nil {
		return
	}
	c.Stop()
	e.notice(tui.KindScreen, e.opts.Name, e.opts.Color, "stopped screen sharing")
	e.sendScreenState()
	e.snapshot()
}

// StartCamera shares a camera; StopCamera releases it (a camera opens once on macOS,
// gotcha 14, so nothing holds it while it is off).
func (e *Engine) StartCamera(d video.Device) error {
	if !e.opts.WebcamEnabled {
		return fmt.Errorf("camera is not available here")
	}
	e.StopCamera()
	c, err := video.Start(video.Webcam, d, 1500,
		func(s video.Sample) { _ = e.peers.WriteVideo("webcam", s) },
		func(reason string) {
			e.mu.Lock()
			was := e.cameraCap != nil
			e.cameraCap, e.cameraDev = nil, nil
			e.mu.Unlock()
			if was {
				e.notice(tui.KindInfo, "", "", "Camera stopped: "+reason)
				e.sendMute()
				e.snapshot()
			}
		}, e.logf)
	if err != nil {
		e.notice(tui.KindInfo, "", "", "Could not open the camera: "+err.Error())
		return err
	}
	e.mu.Lock()
	e.cameraCap, e.cameraDev = c, &d
	e.mu.Unlock()
	e.sendMute()
	e.snapshot()
	return nil
}

func (e *Engine) StopCamera() {
	e.mu.Lock()
	c := e.cameraCap
	e.cameraCap, e.cameraDev = nil, nil
	e.mu.Unlock()
	if c == nil {
		return
	}
	c.Stop()
	e.sendMute()
	e.snapshot()
}

func (e *Engine) ScreenSharing() bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.screenCap != nil
}

func (e *Engine) CameraOn() bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.cameraCap != nil
}

// TogglePeerWindow opens or closes the window for a peer's camera or screen.
func (e *Engine) TogglePeerWindow(peerID, kind string) error {
	e.mu.Lock()
	p := e.people[peerID]
	var r *video.Receiver
	if p != nil {
		if kind == "screen" {
			r = p.screen
		} else {
			r = p.webcam
		}
	}
	e.mu.Unlock()
	if r == nil {
		return fmt.Errorf("nothing to show yet")
	}
	if r.IsOpen() {
		r.CloseWindow()
	} else if err := r.Open(); err != nil {
		e.notice(tui.KindInfo, "", "", "Could not open the window: "+err.Error())
		return err
	}
	e.snapshot()
	return nil
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

// loop reads signaling until the connection drops, then reconnects and joins again — as a
// newcomer, with fresh peer connections, because the server hands a rejoining client a new
// id and every peer builds a new connection towards it. Backoff from a second to thirty;
// only a deliberate Close ends it.
func (e *Engine) loop() {
	for {
		e.readAll()
		e.mu.Lock()
		e.connected = false
		e.mu.Unlock()
		e.snapshot()
		select {
		case <-e.done:
			e.Emit(tui.Left{Reason: "left"})
			return
		default:
		}
		e.notice(tui.KindInfo, "", "", "Connection to the server lost; reconnecting…")
		if !e.reconnect() {
			e.Emit(tui.Left{Reason: "connection closed"})
			return
		}
	}
}

// reconnect tears the room down and dials again until it gets in or Close is called.
func (e *Engine) reconnect() bool {
	e.mu.Lock()
	ids := make([]string, 0, len(e.people))
	for id := range e.people {
		ids = append(ids, id)
	}
	e.people = map[string]*peerInfo{}
	e.mu.Unlock()
	for _, id := range ids {
		e.play.RemovePeer(id)
	}
	e.peers.CloseAll()
	delay := time.Second
	for attempt := 1; ; attempt++ {
		select {
		case <-e.done:
			return false
		case <-time.After(delay):
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		sig, err := signal.Dial(ctx, e.opts.ServerURL)
		cancel()
		if err == nil {
			e.sig = sig
			e.peers.SetSend(sig.Send)
			if err = sig.Send(signal.Message{Type: "join-room", RoomID: e.opts.Room, Username: e.opts.Name, Color: e.opts.Color}); err == nil {
				e.notice(tui.KindInfo, "", "", fmt.Sprintf("Reconnected after %d attempt(s)", attempt))
				return true
			}
			sig.Close()
		}
		e.logf("reconnect attempt %d failed: %v", attempt, err)
		if delay < 30*time.Second {
			delay *= 2
		}
	}
}

// readAll drains one connection's messages until it closes.
func (e *Engine) readAll() {
	for msg := range e.sig.Incoming {
		switch msg.Type {
		case "room-joined":
			e.myID = msg.YourID
			e.peers.SetMyID(e.myID)
			e.mu.Lock()
			e.connected = true
			e.errMsg = ""
			if e.joined.IsZero() {
				e.joined = time.Now()
			}
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
				if e.ScreenSharing() {
					e.sendScreenState() // a newcomer learns the share (gotcha 3)
				}
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
			p := e.people[msg.FromID]
			var was, now bool
			var r *video.Receiver
			if p != nil && msg.IsScreenSharing != nil {
				was, now = p.sharing, *msg.IsScreenSharing
				p.sharing = now
				r = p.screen
			}
			e.mu.Unlock()
			if p != nil && was != now {
				if now {
					e.notice(tui.KindScreen, p.p.Username, p.p.Color, "started screen sharing")
				} else {
					e.notice(tui.KindScreen, p.p.Username, p.p.Color, "stopped screen sharing")
					if r != nil {
						r.CloseWindow() // the window closes with the share (gotcha 3)
					}
				}
			}
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
			CamOn: p.camOn, CamOpen: p.webcam != nil && p.webcam.IsOpen(),
			Screen: p.sharing, ScreenOpen: p.screen != nil && p.screen.IsOpen(),
			Volume: p.volume, RecvKbps: p.recvKbps, LatencyMs: p.latency,
		})
	}
	snap := tui.Snapshot{
		Connected: e.connected, JoinedAt: e.joined, Error: e.errMsg, Debug: e.debug, Stats: e.stats,
		Me:           tui.Peer{Name: e.opts.Name, Color: e.opts.Color, Speaking: mySpeaking, Muted: e.cap != nil && e.cap.Muted(), CamOn: e.cameraCap != nil},
		Peers:        peers,
		VideoEnabled: e.opts.VideoEnabled, WebcamEnabled: e.opts.WebcamEnabled, ScreenSharing: e.screenCap != nil,
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
				frames, rms := e.pump.Captured()
				e.logf("pump: %d late ticks, %d ms ahead, %d device underruns, capture %d frames/s rms %.0f, %d reopens",
					e.pump.Late(), e.pump.AheadMs(), e.pump.Underruns(), frames/2, rms, e.pump.Reopens())
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
				if e.debug {
					for _, r := range []*video.Receiver{p.screen, p.webcam} {
						if r != nil {
							pk, fr := r.Stats()
							e.logf("video in from %s (%s): %d packets, %d frames, window open %v", p.p.Username, r.Kind, pk, fr, r.IsOpen())
						}
					}
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
	e.notice(tui.KindInfo, "", "", "Audio devices changed: "+audio.DisplayName(in)+" → "+audio.DisplayName(out))
	return nil
}

// Close leaves the room and releases everything. Safe to call twice.
func (e *Engine) Close() {
	e.once.Do(func() {
		close(e.done)
		if e.screenCap != nil {
			e.screenCap.Stop()
		}
		if e.cameraCap != nil {
			e.cameraCap.Stop()
		}
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
