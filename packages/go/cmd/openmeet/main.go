// The Go client, audio only: the spike that answers whether encoding once, a playout of our
// own and a renderer that repaints only what changed get a call down to the cost of the
// codec. It speaks the same server and the same WebRTC contract as the Node client, so the
// two share a room.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	osSignal "os/signal"
	"path/filepath"
	"runtime"
	"runtime/pprof"
	"strings"
	"sync"
	"syscall"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/pion/rtp"

	"github.com/manuelvegadev/openmeet/packages/go/internal/audio"
	"github.com/manuelvegadev/openmeet/packages/go/internal/rtc"
	"github.com/manuelvegadev/openmeet/packages/go/internal/signal"
	"github.com/manuelvegadev/openmeet/packages/go/internal/tui"
)

// The Node client's settings file, read for the name, the colour and the devices so the two
// clients look like the same person. Never written.
type settings struct {
	Name          string `json:"name"`
	Color         string `json:"color"`
	AudioInputID  string `json:"audioInputId"`
	AudioOutputID string `json:"audioOutputId"`
	VoiceGate     *bool  `json:"voiceGate"`
}

func loadSettings() settings {
	var s settings
	dir, _ := os.UserConfigDir()
	if runtime.GOOS == "darwin" || runtime.GOOS == "linux" {
		home, _ := os.UserHomeDir()
		dir = filepath.Join(home, ".config")
	}
	data, err := os.ReadFile(filepath.Join(dir, "openmeet", "settings.json"))
	if err == nil {
		// A settings.json saved by Notepad or PowerShell carries a UTF-8 BOM (gotcha 23).
		_ = json.Unmarshal(bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF}), &s)
	}
	return s
}

func main() {
	var (
		server   = flag.String("server", "ws://localhost:3001/ws", "signaling WebSocket URL")
		room     = flag.String("room", "", "room to join")
		name     = flag.String("name", "", "your name (default: the Node client's settings)")
		color    = flag.String("color", "", "your colour, #rrggbb (default: the Node client's settings)")
		inDev    = flag.String("input-device", "", "input device name (substring); default: system default")
		outDev   = flag.String("output-device", "", "output device name (substring); default: system default")
		listDevs = flag.Bool("list-devices", false, "list audio devices and exit")
		noGate   = flag.Bool("no-voice-gate", false, "transmit continuously instead of only while speaking")
		bitrate  = flag.Int("audio-kbps", 64, "Opus bitrate (mono)")
		complex  = flag.Int("opus-complexity", 10, "Opus encoder complexity 0..10")
		headless = flag.Bool("headless", false, "no TUI: log to stderr, quit on SIGINT")
		debug    = flag.Bool("debug", false, "write the engine's log to stderr (TUI) / stdout (headless)")
		profile  = flag.String("cpuprofile", "", "write a CPU profile here until exit")
		muted    = flag.Bool("start-muted", false, "join muted")
		noAudio  = flag.Bool("no-audio", false, "open no audio devices (measures the network path alone)")
		period   = flag.Int("period-ms", 10, "audio device period in ms (experiment)")
		fullRTP  = flag.Bool("full-interceptors", false, "pion with NACK and TWCC too (audio needs neither; experiment)")
	)
	flag.Parse()
	log.SetFlags(log.Ltime | log.Lmicroseconds)
	if *profile != "" {
		f, err := os.Create(*profile)
		if err != nil {
			log.Fatal(err)
		}
		_ = pprof.StartCPUProfile(f)
		defer pprof.StopCPUProfile()
	}

	audio.PeriodMs = *period
	rtc.LeanInterceptors = !*fullRTP
	engine, err := audio.NewEngine()
	if err != nil {
		log.Fatal(err)
	}
	defer engine.Close()
	inputs, _ := engine.Inputs()
	outputs, _ := engine.Outputs()
	if *listDevs {
		fmt.Println("inputs:")
		for _, d := range inputs {
			fmt.Printf("  %s%s\n", d.Name, mark(d.Default))
		}
		fmt.Println("outputs:")
		for _, d := range outputs {
			fmt.Printf("  %s%s\n", d.Name, mark(d.Default))
		}
		return
	}
	if *room == "" {
		log.Fatal("--room is required")
	}
	cfg := loadSettings()
	if *name == "" {
		*name = cfg.Name
	}
	if *name == "" {
		*name = "go"
	}
	if *color == "" {
		*color = cfg.Color
	}
	if *color == "" {
		*color = "#E8B900"
	}
	gate := !*noGate
	if cfg.VoiceGate != nil && !*noGate {
		gate = *cfg.VoiceGate
	}
	input, err := audio.Find(inputs, *inDev)
	if err != nil {
		log.Fatal(err)
	}
	output, err := audio.Find(outputs, *outDev)
	if err != nil {
		log.Fatal(err)
	}

	// ── the log: stderr, or into the TUI as notices when asked ─────────────────
	var program *tea.Program
	var logMu sync.Mutex
	logf := func(format string, args ...any) {
		if !*debug {
			return
		}
		line := fmt.Sprintf(format, args...)
		logMu.Lock()
		defer logMu.Unlock()
		if *headless || program == nil {
			log.Print(line)
		} else {
			program.Send(tui.Notice(line))
		}
	}
	// Events reach the TUI through a channel a forwarder drains: program.Send blocks until
	// the event loop takes the message, and some callers are the audio thread.
	events := make(chan tea.Msg, 256)
	emit := func(msg tea.Msg) {
		if *headless {
			switch msg.(type) {
			case tui.Speaking, tui.State, tui.Chat, tui.Muted:
				logf("%T%+v", msg, msg)
			}
			return
		}
		select {
		case events <- msg:
		default:
		}
	}

	// ── signaling ─────────────────────────────────────────────────────────────
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	sig, err := signal.Dial(ctx, *server)
	cancel()
	if err != nil {
		log.Fatal(err)
	}
	defer sig.Close()

	// ── the mesh ──────────────────────────────────────────────────────────────
	playout := audio.NewPlayout(func(id string, on bool) { emit(tui.Speaking{ID: id, On: on}) })
	peers, err := rtc.NewManager(rtc.Options{
		Send:    sig.Send,
		OnAudio: func(peerID string, pkt *rtp.Packet) { playout.Push(peerID, pkt) },
		OnState: func(peerID, state string) { emit(tui.State{ID: peerID, State: state}) },
		Log:     logf,
	})
	if err != nil {
		log.Fatal(err)
	}
	defer peers.CloseAll()

	// ── the microphone, encoded once ──────────────────────────────────────────
	var myID string
	capture, err := audio.NewCapture(audio.CaptureOptions{Bitrate: *bitrate * 1000, Complexity: *complex, VoiceGate: gate},
		func(p audio.Packet) { _ = peers.Write(p) },
		func(on bool) { emit(tui.Speaking{ID: myID, On: on}) })
	if err != nil {
		log.Fatal(err)
	}
	capture.SetMuted(*muted)
	var pump *audio.Pump
	if !*noAudio {
		pump, err = engine.StartPump(input, output, capture.OnPCM, playout.Fill)
		if err != nil {
			log.Fatal(err)
		}
		defer pump.Close()
		logf("audio: %s", pump.Describe())
	}

	// ── the room ──────────────────────────────────────────────────────────────
	var mu sync.Mutex
	people := map[string]signal.Participant{}
	sendMute := func() {
		m := capture.Muted()
		_ = sig.Send(signal.Message{Type: "mute-state", FromID: myID, IsAudioMuted: &m})
	}
	publish := func() {
		mu.Lock()
		list := make([]tui.Person, 0, len(people))
		for _, p := range people {
			list = append(list, tui.Person{ID: p.ID, Name: p.Username, Color: colorOr(p.Color)})
		}
		mu.Unlock()
		emit(tui.Participants{Me: tui.Person{ID: myID, Name: *name, Color: *color}, List: list})
	}
	done := make(chan struct{})
	var once sync.Once
	finish := func() { once.Do(func() { close(done) }) }

	actions := tui.Actions{
		ToggleMute: func() {
			capture.SetMuted(!capture.Muted())
			emit(tui.MyMuted(capture.Muted()))
			sendMute()
		},
		SendChat: func(text string) {
			_ = sig.Send(signal.Message{
				Type: "chat-message", ID: fmt.Sprintf("%d", time.Now().UnixNano()), RoomID: *room,
				Username: *name, Content: text, Timestamp: time.Now().UnixMilli(),
			})
		},
		Quit: finish,
	}

	go func() {
		for msg := range sig.Incoming {
			switch msg.Type {
			case "room-joined":
				myID = msg.YourID
				peers.SetMyID(myID)
				mu.Lock()
				for _, p := range msg.Participants {
					people[p.ID] = p
				}
				mu.Unlock()
				publish()
				sendMute()
				for _, p := range msg.Participants {
					_ = playout.AddPeer(p.ID)
					peers.Offer(p.ID)
				}
				logf("joined %s as %s with %d peers", *room, rtcShort(myID), len(msg.Participants))
			case "participant-joined":
				if msg.Participant != nil {
					mu.Lock()
					people[msg.Participant.ID] = *msg.Participant
					mu.Unlock()
					_ = playout.AddPeer(msg.Participant.ID)
					publish()
					sendMute()
					emit(tui.Notice(msg.Participant.Username + " joined"))
				}
			case "participant-left":
				mu.Lock()
				p, known := people[msg.ParticipantID]
				delete(people, msg.ParticipantID)
				mu.Unlock()
				playout.RemovePeer(msg.ParticipantID)
				peers.Remove(msg.ParticipantID)
				publish()
				if known {
					emit(tui.Notice(p.Username + " left"))
				}
			case "offer":
				peers.HandleOffer(msg.FromID, msg.SDP)
			case "answer":
				peers.HandleAnswer(msg.FromID, msg.SDP)
			case "ice-candidate":
				peers.HandleCandidate(msg.FromID, msg.Candidate)
			case "mute-state":
				if msg.IsAudioMuted != nil {
					emit(tui.Muted{ID: msg.FromID, On: *msg.IsAudioMuted})
				}
			case "chat-broadcast":
				if c := msg.ChatMessage; c != nil {
					emit(tui.Chat{Who: c.Username, Color: colorOr(c.Color), Text: c.Content, At: time.UnixMilli(c.Timestamp)})
				}
			case "error":
				logf("server: %s", msg.ErrorMessage)
			}
		}
		finish()
	}()

	if err := sig.Send(signal.Message{Type: "join-room", RoomID: *room, Username: *name, Color: *color}); err != nil {
		log.Fatal(err)
	}

	// A stats line every two seconds, like the Node client's header.
	go func() {
		t := time.NewTicker(2 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-done:
				return
			case <-t.C:
				mu.Lock()
				ids := make([]string, 0, len(people))
				for id := range people {
					ids = append(ids, id)
				}
				mu.Unlock()
				var parts []string
				for _, id := range ids {
					u, d, c, depth, rx, ts := playout.Stats(id)
					parts = append(parts, fmt.Sprintf("%s u%d d%d c%d q%d rx%d ts%d", rtcShort(id), u, d, c, depth, rx, ts))
				}
				if pump != nil {
					parts = append(parts, fmt.Sprintf("dev-underruns %d", pump.Underruns()))
				}
				emit(tui.Stats(strings.Join(parts, "  ")))
				if *headless && *debug {
					logf("%s | %s", peers.Stats(), strings.Join(parts, "  "))
				}
			}
		}
	}()

	if *headless {
		log.Printf("headless: in room %s, ctrl-c to leave", *room)
		sigc := make(chan os.Signal, 1)
		osSignal.Notify(sigc, os.Interrupt, syscall.SIGTERM)
		select {
		case <-done:
		case <-sigc:
		}
		return
	}
	program = tea.NewProgram(tui.New(*room, actions), tea.WithAltScreen())
	go func() {
		for {
			select {
			case msg := <-events:
				program.Send(msg)
			case <-done:
				program.Send(tui.Finished{})
				return
			}
		}
	}()
	if _, err := program.Run(); err != nil {
		log.Fatal(err)
	}
	finish()
}

func mark(def bool) string {
	if def {
		return "  (default)"
	}
	return ""
}

func colorOr(c string) string {
	if c == "" {
		return "#8A8A8A"
	}
	return c
}

func rtcShort(id string) string {
	if len(id) > 6 {
		return id[:6]
	}
	return id
}
