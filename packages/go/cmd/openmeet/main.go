// The Go client: one process with the interface, the audio and the mesh. It speaks the same
// server and the same WebRTC contract as the Node client, and draws the same screens.
package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	osSignal "os/signal"
	"runtime"
	"runtime/pprof"
	"strings"
	"syscall"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/manuelvegadev/openmeet/packages/go/internal/audio"
	"github.com/manuelvegadev/openmeet/packages/go/internal/engine"
	"github.com/manuelvegadev/openmeet/packages/go/internal/settings"
	"github.com/manuelvegadev/openmeet/packages/go/internal/tui"
)

// Version is set at build time (-ldflags "-X main.Version=…"); the scripts read it from
// packages/terminal/package.json so both clients report the one version.
var Version = "dev"

func platformSupport() (name, features string) {
	switch runtime.GOOS {
	case "darwin":
		return "macOS", "audio, chat"
	case "windows":
		return "Windows", "audio, chat"
	case "linux":
		return "Linux", "best effort"
	}
	return runtime.GOOS, "unsupported"
}

// ── the host: settings and devices as the interface sees them ───────────────

type store struct{ s settings.App }

func (st *store) Name() string  { return settings.Str(st.s.Name) }
func (st *store) Color() string { return settings.Str(st.s.Color) }
func (st *store) SetIdentity(name, color string) {
	st.s.Name, st.s.Color = settings.Ptr(name), settings.Ptr(color)
	_ = settings.Save(st.s)
}
func (st *store) InputID() string         { return settings.Str(st.s.AudioInputID) }
func (st *store) OutputID() string        { return settings.Str(st.s.AudioOutputID) }
func (st *store) DevicesConfigured() bool { return st.s.DevicesConfigured }
func (st *store) SetDevices(in, out string) {
	st.s.AudioInputID, st.s.AudioOutputID, st.s.DevicesConfigured = settings.Ptr(in), settings.Ptr(out), true
	_ = settings.Save(st.s)
}

func orDefault(s string) string {
	if s == "" {
		return "System Default"
	}
	return s
}

func (st *store) Rows() []tui.SettingsRow {
	s := st.s
	noise := "Off"
	if s.NoiseSuppression {
		noise = "On (RNNoise, CPU)"
	}
	gate := "Off (always sending)"
	if s.VoiceGate {
		gate = "On (silence is not sent)"
	}
	overlay := "Off"
	if s.VideoOverlay {
		overlay = "On"
	}
	updates := map[string]string{"auto": "install on exit", "notify": "tell me, do not install", "off": "do not check"}[s.AutoUpdate]
	rows := []tui.SettingsRow{
		{Label: "Profile", Value: tui.Bracketed(st.Name()), ValueColor: st.Color()},
		{Label: "Audio Input", Value: orDefault(st.InputID())},
		{Label: "Audio Output", Value: orDefault(st.OutputID())},
	}
	if runtime.GOOS == "darwin" {
		cam := "Default (0)"
		if v := settings.Str(s.VideoDeviceID); v != "" {
			cam = "Device " + v
		}
		rows = append(rows, tui.SettingsRow{Label: "Camera", Value: cam})
	}
	rows = append(rows,
		tui.SettingsRow{Label: "Video Overlay", Value: overlay},
		tui.SettingsRow{Label: "Mic Channels", Value: s.AudioInputChannels},
		tui.SettingsRow{Label: "Noise Suppression", Value: noise},
		tui.SettingsRow{Label: "Voice Gate", Value: gate},
		tui.SettingsRow{Label: "Audio Send", Value: fmt.Sprintf("%d kbps (applies on next join)", s.AudioSendKbps)},
		tui.SettingsRow{Label: "Audio Receive", Value: fmt.Sprintf("%d kbps (applies on next join)", s.AudioReceiveKbps)},
		tui.SettingsRow{Label: "Screen Send", Value: fmt.Sprintf("%d kbps per peer at 1080p (applies on next join)", s.ScreenSendKbps)},
		tui.SettingsRow{Label: "Screen Receive", Value: fmt.Sprintf("%d kbps from each peer (applies on next join)", s.ScreenReceiveKbps)},
		tui.SettingsRow{Label: "Updates", Value: updates},
		tui.SettingsRow{Label: "Pause Rendering", Value: fmt.Sprintf("when %s (applies on next start)", s.PauseRendering)},
	)
	return rows
}

var (
	channelPolicies = []string{"auto", "stereo", "mono", "left", "right"}
	audioKbpsSteps  = []int{64, 96, 128, 192, 256}
	screenKbpsSteps = []int{1000, 1500, 2500, 4000, 6000, 10000}
	updatePolicies  = []string{"auto", "notify", "off"}
	pausePolicies   = []string{"minimized", "unfocused", "never"}
)

func cycle(list []string, cur string) string {
	for i, v := range list {
		if v == cur {
			return list[(i+1)%len(list)]
		}
	}
	return list[0]
}
func cycleNumber(list []int, cur int) int {
	for i, v := range list {
		if v >= cur {
			return list[(i+1)%len(list)]
		}
	}
	return list[0]
}

// Run is what Enter does on a row: cycles a value, or names the screen to open.
func (st *store) Run(idx int) string {
	labels := []string{}
	for _, r := range st.Rows() {
		labels = append(labels, r.Label)
	}
	if idx >= len(labels) {
		return ""
	}
	s := &st.s
	switch labels[idx] {
	case "Profile":
		return "profile"
	case "Audio Input":
		return "input"
	case "Audio Output":
		return "output"
	case "Camera":
		return "camera"
	case "Video Overlay":
		s.VideoOverlay = !s.VideoOverlay
	case "Mic Channels":
		s.AudioInputChannels = cycle(channelPolicies, s.AudioInputChannels)
	case "Noise Suppression":
		s.NoiseSuppression = !s.NoiseSuppression
	case "Voice Gate":
		s.VoiceGate = !s.VoiceGate
	case "Audio Send":
		s.AudioSendKbps = cycleNumber(audioKbpsSteps, s.AudioSendKbps)
	case "Audio Receive":
		s.AudioReceiveKbps = cycleNumber(audioKbpsSteps, s.AudioReceiveKbps)
	case "Screen Send":
		s.ScreenSendKbps = cycleNumber(screenKbpsSteps, s.ScreenSendKbps)
	case "Screen Receive":
		s.ScreenReceiveKbps = cycleNumber(screenKbpsSteps, s.ScreenReceiveKbps)
	case "Updates":
		s.AutoUpdate = cycle(updatePolicies, s.AutoUpdate)
	case "Pause Rendering":
		s.PauseRendering = cycle(pausePolicies, s.PauseRendering)
	}
	_ = settings.Save(st.s)
	return ""
}

type devices struct{ a *audio.Engine }

func names(list []audio.Device) []string {
	out := make([]string, 0, len(list))
	for _, d := range list {
		out = append(out, d.Name)
	}
	return out
}

func (d *devices) Inputs() []string  { l, _ := d.a.Inputs(); return names(l) }
func (d *devices) Outputs() []string { l, _ := d.a.Outputs(); return names(l) }

// Resolve matches a saved id to a listed name: exactly, then as the tail of a name the
// Node client's RtAudio backend prefixed ("Roland: STREAM (…)" is "STREAM (…)" here), then
// as a substring, so a settings file from the other client still names the same device.
func (d *devices) Resolve(saved string, list []string) string {
	if saved == "" {
		return ""
	}
	for _, n := range list {
		if n == saved {
			return n
		}
	}
	for _, n := range list {
		if strings.HasSuffix(saved, n) || strings.HasSuffix(n, saved) {
			return n
		}
	}
	needle := strings.ToLower(saved)
	for _, n := range list {
		if strings.Contains(strings.ToLower(n), needle) {
			return n
		}
	}
	return ""
}

func (d *devices) find(name string, playback bool) *audio.Device {
	if name == "" {
		return nil
	}
	var list []audio.Device
	if playback {
		list, _ = d.a.Outputs()
	} else {
		list, _ = d.a.Inputs()
	}
	for i := range list {
		if list[i].Name == name {
			return &list[i]
		}
	}
	return nil
}

func (d *devices) StartMicTest(input, output string) (tui.MicTest, error) {
	return d.a.StartMicTest(d.find(input, false), d.find(output, true))
}

// roomSession adapts the engine to what the interface asks of a room.
type roomSession struct {
	e *engine.Engine
	d *devices
}

func (r *roomSession) ToggleMute()                    { r.e.ToggleMute() }
func (r *roomSession) SendChat(text string)           { r.e.SendChat(text) }
func (r *roomSession) SetVolume(id string, v float64) { r.e.SetVolume(id, v) }
func (r *roomSession) ToggleDebug()                   { r.e.ToggleDebug() }
func (r *roomSession) Close()                         { r.e.Close() }
func (r *roomSession) UpdateDevices(in, out string) error {
	return r.e.UpdateDevices(r.d.find(in, false), r.d.find(out, true))
}

func main() {
	var (
		server   = flag.String("server", "wss://openmeet.mvega.pro/ws", "signaling WebSocket URL")
		room     = flag.String("room", "", "room to join straight away")
		inDev    = flag.String("input-device", "", "input device name (skips the picker)")
		outDev   = flag.String("output-device", "", "output device name (skips the picker)")
		listDevs = flag.Bool("list-devices", false, "list audio devices and exit")
		noGate   = flag.Bool("no-voice-gate", false, "transmit continuously instead of only while speaking (saved)")
		bitrate  = flag.Int("audio-kbps", 64, "Opus bitrate (mono)")
		complex  = flag.Int("opus-complexity", 10, "Opus encoder complexity 0..10")
		debug    = flag.Bool("debug", false, "start with the debug panel on")
		profile  = flag.String("cpuprofile", "", "write a CPU profile here until exit")
		version  = flag.Bool("version", false, "print the version and exit")
	)
	flag.Parse()
	if *version {
		fmt.Println(Version)
		return
	}
	log.SetFlags(0)
	if *profile != "" {
		f, err := os.Create(*profile)
		if err != nil {
			log.Fatal(err)
		}
		_ = pprof.StartCPUProfile(f)
		defer pprof.StopCPUProfile()
	}

	a, err := audio.NewEngine()
	if err != nil {
		log.Fatal(err)
	}
	defer a.Close()
	dev := &devices{a: a}
	if *listDevs {
		for _, kind := range []struct {
			label string
			list  []string
		}{{"inputs", dev.Inputs()}, {"outputs", dev.Outputs()}} {
			fmt.Println(kind.label + ":")
			for _, n := range kind.list {
				fmt.Println("  " + n)
			}
		}
		return
	}

	st := &store{s: settings.Load()}
	if *noGate {
		st.s.VoiceGate = false
		_ = settings.Save(st.s)
	}
	name, features := platformSupport()

	events := make(chan tea.Msg, 512)
	emit := func(msg interface{}) {
		select {
		case events <- msg:
		default:
		}
	}
	host := tui.Host{
		Version: Version, Platform: name, Features: features,
		Settings: st, Devices: dev,
		InitialRoom: *room, InputFlag: *inDev, OutputFlag: *outDev,
		Join: func(roomID, name, color, input, output string) (tui.Room, error) {
			e := engine.New(a, engine.Options{
				ServerURL: *server, Room: roomID, Name: name, Color: color,
				Input: dev.find(input, false), Output: dev.find(output, true),
				VoiceGate: st.s.VoiceGate, Bitrate: *bitrate * 1000, Complex: *complex, Debug: *debug,
			}, emit)
			if err := e.Start(); err != nil {
				return nil, err
			}
			return &roomSession{e: e, d: dev}, nil
		},
	}

	model := tui.New(host)
	program := tea.NewProgram(model, tea.WithAltScreen())
	go func() {
		for msg := range events {
			program.Send(msg)
		}
	}()
	sigc := make(chan os.Signal, 1)
	osSignal.Notify(sigc, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sigc
		program.Send(tea.KeyMsg{Type: tea.KeyCtrlC})
		time.Sleep(time.Second)
		os.Exit(0)
	}()
	if _, err := program.Run(); err != nil {
		log.Fatal(err)
	}
}
