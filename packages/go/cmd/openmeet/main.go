// The Go client: one process with the interface, the audio and the mesh. It speaks the same
// server and the same WebRTC contract as the Node client, and draws the same screens.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	osSignal "os/signal"
	"runtime"
	"runtime/pprof"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/manuelvegadev/openmeet/packages/go/internal/audio"
	"github.com/manuelvegadev/openmeet/packages/go/internal/engine"
	"github.com/manuelvegadev/openmeet/packages/go/internal/settings"
	"github.com/manuelvegadev/openmeet/packages/go/internal/tui"
	"github.com/manuelvegadev/openmeet/packages/go/internal/update"
	"github.com/manuelvegadev/openmeet/packages/go/internal/video"
)

// Version is set at build time (-ldflags "-X main.Version=…"); the scripts read it from
// packages/terminal/package.json so both clients report the one version.
var Version = "dev"

func platformSupport() (name, features string) {
	switch runtime.GOOS {
	case "darwin":
		return "macOS", "audio, chat, video, screen share"
	case "windows":
		return "Windows", "audio, chat, screen share"
	case "linux":
		return "Linux", "best effort"
	}
	return runtime.GOOS, "unsupported"
}

// ── the host: settings and devices as the interface sees them ───────────────

type store struct {
	s settings.App
	// The chosen camera's name, once it has been looked up (cameraName).
	camName string
}

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

// The updater's daily cache, in the same settings the Node client kept it in.
func (st *store) LastCheck() time.Time { return time.UnixMilli(st.s.LastUpdateCheck) }
func (st *store) LatestSeen() string   { return settings.Str(st.s.LatestSeen) }
func (st *store) SetCheck(at time.Time, latest string) {
	st.s.LastUpdateCheck, st.s.LatestSeen = at.UnixMilli(), settings.Ptr(latest)
	_ = settings.Save(st.s)
}

// CameraID is the camera a share uses, "" for the system's first.
func (st *store) CameraID() string { return settings.Str(st.s.VideoDeviceID) }

func (st *store) SetCamera(id string) {
	st.s.VideoDeviceID = nil
	if id != "" {
		st.s.VideoDeviceID = settings.Ptr(id)
	}
	st.camName = ""
	_ = settings.Save(st.s)
}

// cameraName is the chosen camera's own name, looked up once and kept: Rows runs on the
// interface's goroutine, and enumerating cameras spawns ffmpeg for about a third of a second.
func (st *store) cameraName() string {
	id := st.CameraID()
	if id == "" {
		return "Default (0)"
	}
	if st.camName == "" {
		st.camName = "Device " + id
		if d := video.ByID(video.Cameras(), id); d != nil {
			st.camName = d.Label()
		}
	}
	return st.camName
}

func orDefault(s string) string {
	if s == "" {
		return "System Default"
	}
	return s
}

// The settings, in sections. Only rows that do something are here: the Node client's
// Noise Suppression, Audio Receive, Screen Receive, Mic Channels, Video Overlay and Pause
// Rendering had nothing behind them in this client — the fields stay in settings.json, and
// what each would take is in docs/backlog.md, but a row that does nothing is worse than no
// row, and this is where someone goes to understand why a call sounds the way it does.
//
// A row with a fixed set of values carries all of them, so the screen shows what a setting
// could be and not only what it is. Nothing says "applies on next join": everything here
// does, the dot beside the title says it once, and this screen is only reachable from the
// home screen anyway.
func (st *store) Rows() []tui.SettingsRow {
	s := st.s
	rows := []tui.SettingsRow{
		{Tab: "Audio", Label: "Audio Input", Value: orDefault(st.InputID()),
			Help: "Where your voice is taken from. Devices that carry their own effects are offered first."},
		{Tab: "Audio", Label: "Audio Output", Value: orDefault(st.OutputID()),
			Help: "Where the room is played back."},
	}
	if proc := processingChoices(); proc != nil {
		rows = append(rows, tui.SettingsRow{Tab: "Audio", Label: "Audio Processing",
			Choices: proc, Choice: boolChoice(s.AudioProcessing != "raw"), Help: processingHelp()})
	}
	rows = append(rows,
		tui.SettingsRow{Tab: "Audio", Label: "Mic Level", Choices: []string{"Auto", "Off"}, Choice: boolChoice(s.MicLevel != "off"),
			Help: "Levels your voice, up to +18 dB, so you arrive as loud as everyone else. Ours, for the devices whose driver does none."},
		tui.SettingsRow{Tab: "Audio", Label: "Voice Gate", Choices: []string{"On", "Off"}, Choice: boolChoice(s.VoiceGate),
			Help: "While you are silent nothing is encoded, sent or decoded anywhere in the room — which is most of a call."},
		tui.SettingsRow{Tab: "Audio", Label: "Audio Send", Choices: numbers(audioKbpsSteps), Choice: slices.Index(audioKbpsSteps, s.AudioSendKbps), Suffix: "kbps",
			Help: "What the one Opus encoder spends. It encodes once for the whole room, so this is the same whoever is in it."},
	)
	if runtime.GOOS == "darwin" {
		rows = append(rows, tui.SettingsRow{Tab: "Video", Label: "Camera", Value: st.cameraName(), Help: "Which camera a share uses."})
	}
	rows = append(rows,
		tui.SettingsRow{Tab: "Video", Label: "Screen Send", Choices: numbers(screenKbpsSteps), Choice: slices.Index(screenKbpsSteps, s.ScreenSendKbps), Suffix: "kbps",
			Help: "What each person watching gets, whoever else is watching: the share is encoded once, on the GPU, and the same picture goes to everyone. Only the upload multiplies — measured, the sender's CPU does not move with the number of peers."},
		tui.SettingsRow{Tab: "Advanced", Label: "Upload Ceiling", Choices: uploadLabels(), Choice: slices.Index(uploadSteps, s.ScreenUploadKbps), Suffix: "Mbps for a share, everyone together",
			Help: "Off means each viewer gets the rate you chose and your upload carries the rest: five people watching at 2500 kbps is 12.5 Mbps up. Set it and everyone's rate comes down together instead; it is read when a share starts."},
		tui.SettingsRow{Tab: "Advanced", Label: "Opus Complexity", Choices: numbers(complexitySteps), Choice: slices.Index(complexitySteps, s.OpusComplexity),
			Help: "How hard the encoder works for the same bitrate: 10 is the best sound per kbps and the most CPU, 1 the cheapest. It never changes what is sent."},
		tui.SettingsRow{Tab: "Other", Label: "Profile", Value: tui.Bracketed(st.Name()), ValueColor: st.Color(),
			Help: "Your name and colour, as everyone in the room sees them."},
		tui.SettingsRow{Tab: "Other", Label: "Updates", Choices: []string{"install on exit", "tell me", "do not check"}, Choice: slices.Index(updatePolicies, s.AutoUpdate),
			Help: "A newer version is looked for once a day and downloaded before it is offered; the home screen says so when one is ready."},
	)
	return rows
}

// The ceiling's labels: "off" for none, Mbps for the rest.
func uploadLabels() []string {
	out := make([]string, len(uploadSteps))
	for i, v := range uploadSteps {
		out[i] = "off"
		if v > 0 {
			out[i] = strconv.Itoa(v / 1000)
		}
	}
	return out
}

// What the encoder costs, on the one scale both tabs draw it on; the Audio tab adds the
// rest of its path on top.
func opusCPU(complexity int) float64 { return 0.10 + float64(complexity)*0.02 }

func boolChoice(on bool) int {
	if on {
		return 0
	}
	return 1
}

func numbers(list []int) []string {
	out := make([]string, len(list))
	for i, v := range list {
		out[i] = strconv.Itoa(v)
	}
	return out
}

// What the system's own voice processing is called here, and what it is worth. There is no
// such thing on Linux, so there is no row there either.
func processingChoices() []string {
	switch runtime.GOOS {
	case "darwin":
		return []string{"Apple", "Off"}
	case "windows":
		return []string{"Windows", "Off"}
	}
	return nil
}

func processingHelp() string {
	if runtime.GOOS == "windows" {
		return "Windows' communications mode: the echo cancellation, noise suppression and gain the device's own driver brings — a laptop microphone usually brings some, a USB interface often none."
	}
	return "Apple's voice processing unit: Voice Isolation, echo cancellation and gain, for about a tenth of a core."
}

// Meters are the two or three bars under the settings: what this section's choices cost the
// machine and the network, and what they buy. The weights are anchored on measurements in
// docs/performance.md — Apple's unit against raw devices, a hardware H.264 encoder against a
// software one, what the voice gate saves — and are an estimate, not a prediction: the point
// is that a choice's price is visible before it is made.
func (st *store) Meters(tab string) []tui.Meter {
	s := st.s
	switch tab {
	case "Audio":
		cpu := opusCPU(s.OpusComplexity)
		what := "raw"
		if s.AudioProcessing != "raw" {
			cpu += 0.35
			what = "Apple"
			if runtime.GOOS == "windows" {
				what = "Windows"
			}
		}
		if s.MicLevel != "off" {
			cpu += 0.03
			what += " + level"
		}
		if !s.VoiceGate {
			cpu += 0.12
		}
		net := float64(s.AudioSendKbps) / 256
		netNote := fmt.Sprintf("%d kbps while you talk", s.AudioSendKbps)
		if s.VoiceGate {
			net *= 0.45
			netNote += ", nothing while you do not"
		}
		quality := 0.35 + float64(s.AudioSendKbps-64)/192*0.45
		if s.AudioProcessing != "raw" {
			quality += 0.15
		}
		if s.MicLevel != "off" {
			quality += 0.05
		}
		return []tui.Meter{
			{Label: "CPU", Fill: cpu, Note: what},
			{Label: "Network", Fill: net, Note: netNote},
			{Label: "Quality", Fill: quality, Note: fmt.Sprintf("Opus %d kbps", s.AudioSendKbps), Good: true},
		}
	case "Video":
		enc := video.Encoder()
		// The network bar is what a full room would ask of the upload — five people watching
		// — because that is the number the mesh makes grow, not the rate itself.
		net := float64(s.ScreenSendKbps*5) / 50000
		netNote := fmt.Sprintf("%d kbps to each viewer, %.1f Mbps up with five", s.ScreenSendKbps, float64(s.ScreenSendKbps*5)/1000)
		if s.ScreenUploadKbps > 0 {
			net = float64(s.ScreenUploadKbps) / 50000
			netNote = fmt.Sprintf("%d kbps each, capped at %d Mbps together", s.ScreenSendKbps, s.ScreenUploadKbps/1000)
		}
		cpu, note := 0.30, enc
		if !video.Hardware() {
			cpu, note = 0.95, "libx264 (no hardware encoder found)"
		}
		return []tui.Meter{
			{Label: "CPU", Fill: cpu, Note: note},
			{Label: "Network", Fill: net, Note: netNote},
			{Label: "Quality", Fill: 0.3 + float64(s.ScreenSendKbps-1000)/9000*0.7, Note: "at 1080p30", Good: true},
		}
	case "Advanced":
		c := s.OpusComplexity
		return []tui.Meter{
			{Label: "CPU", Fill: opusCPU(c), Note: "the Opus encoder"},
			{Label: "Quality", Fill: 0.45 + float64(c)*0.055, Note: "at the same bitrate", Good: true},
		}
	}
	return nil
}

var (
	complexitySteps = []int{1, 3, 5, 8, 10}
	// The two-state rows, in the order their chips are drawn.
	processingValues = []string{"system", "raw"}
	micLevelValues   = []string{"auto", "off"}
	// In kbps, as they are stored; 0 is no ceiling, and the row prints them in Mbps.
	uploadSteps     = []int{0, 5000, 10000, 20000, 50000}
	audioKbpsSteps  = []int{64, 96, 128, 192, 256}
	screenKbpsSteps = []int{1000, 1500, 2500, 4000, 6000, 10000}
	updatePolicies  = []string{"auto", "notify", "off"}
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
	case "Audio Processing":
		s.AudioProcessing = cycle(processingValues, s.AudioProcessing)
	case "Mic Level":
		s.MicLevel = cycle(micLevelValues, s.MicLevel)
	case "Upload Ceiling":
		s.ScreenUploadKbps = cycleNumber(uploadSteps, s.ScreenUploadKbps)
	case "Opus Complexity":
		s.OpusComplexity = cycleNumber(complexitySteps, s.OpusComplexity)
	case "Voice Gate":
		s.VoiceGate = !s.VoiceGate
	case "Audio Send":
		s.AudioSendKbps = cycleNumber(audioKbpsSteps, s.AudioSendKbps)
	case "Screen Send":
		s.ScreenSendKbps = cycleNumber(screenKbpsSteps, s.ScreenSendKbps)
	case "Updates":
		s.AutoUpdate = cycle(updatePolicies, s.AutoUpdate)
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

// Effects a device carries, by name. These are the devices someone chose on purpose —
// NVIDIA Broadcast, Elgato's Wave Link — and whose processed audio lives on a virtual
// endpoint beside the raw one; picking the raw one is how the effects go missing.
func effects(name string) string {
	l := strings.ToLower(name)
	switch {
	case strings.Contains(l, "nvidia broadcast"):
		return "GPU noise removal + echo cancellation"
	case strings.Contains(l, "wave link microphonefx"):
		return "Elgato Wave Link effects applied"
	}
	return ""
}

// preferEffects puts the devices that carry effects first, keeping the rest in order.
func preferEffects(list []audio.Device) []audio.Device {
	var first, rest []audio.Device
	for _, d := range list {
		if effects(d.Name) != "" {
			first = append(first, d)
		} else {
			rest = append(rest, d)
		}
	}
	return append(first, rest...)
}

func (d *devices) Inputs() []string  { l, _ := d.a.Inputs(); return names(preferEffects(l)) }
func (d *devices) Outputs() []string { l, _ := d.a.Outputs(); return names(l) }

func (d *devices) Label(name string) string {
	if e := effects(name); e != "" {
		return name + " — " + e
	}
	return name
}

// EffectsSibling: Elgato's Wave microphones show up raw under their own name while Wave
// Link puts the processed signal on "Wave Link MicrophoneFX"; choosing the raw one is how
// "noise removal does nothing" happens on a Mac. Only when the sibling is actually listed.
func (d *devices) EffectsSibling(name string, list []string) string {
	l := strings.ToLower(name)
	if !strings.Contains(l, "wave") || effects(name) != "" {
		return ""
	}
	for _, n := range list {
		if strings.Contains(strings.ToLower(n), "wave link microphonefx") {
			return n
		}
	}
	return ""
}

func (d *devices) IsBluetooth(name string) bool {
	for _, playback := range []bool{false, true} {
		if dev := d.find(name, playback); dev != nil && dev.Bluetooth {
			return true
		}
	}
	return false
}

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
func (r *roomSession) StartScreen(id string) error {
	for _, d := range video.Screens() {
		if d.ID == id {
			return r.e.StartScreen(d)
		}
	}
	return fmt.Errorf("no such screen")
}
func (r *roomSession) StopScreen() { r.e.StopScreen() }
func (r *roomSession) StartCamera(id string) error {
	for _, d := range video.Cameras() {
		if d.ID == id {
			return r.e.StartCamera(d)
		}
	}
	return fmt.Errorf("no such camera")
}
func (r *roomSession) StopCamera() { r.e.StopCamera() }
func (r *roomSession) TogglePeerWindow(peerID, kind string) error {
	return r.e.TogglePeerWindow(peerID, kind)
}

func choices(list []video.Device) []tui.VideoChoice {
	out := make([]tui.VideoChoice, 0, len(list))
	for _, d := range list {
		out = append(out, tui.VideoChoice{ID: d.ID, Label: d.Label()})
	}
	return out
}

// preview runs a capture into a window with no room: --test-screen and --test-camera.
func preview(kind video.Kind, d video.Device) {
	fps := video.ScreenFPS
	if kind == video.Webcam {
		fps = video.CameraFPS
	}
	p, err := video.NewPlayer("openmeet preview · "+d.Label(), fps)
	if err != nil {
		log.Fatal(err)
	}
	c, err := video.Start(kind, d, 2500, func(s video.Sample) { p.Write(s.Data) },
		func(reason string) { log.Print("capture ended: ", reason) }, func(f string, a ...any) { log.Printf(f, a...) })
	if err != nil {
		log.Fatal(err)
	}
	log.Print("preview open; close the window or press ctrl-c")
	sigc := make(chan os.Signal, 1)
	osSignal.Notify(sigc, os.Interrupt, syscall.SIGTERM)
	for !p.Closed() {
		select {
		case <-sigc:
			c.Stop()
			p.Close()
			return
		case <-time.After(200 * time.Millisecond):
		}
	}
	c.Stop()
}

func main() {
	var (
		server   = flag.String("server", "wss://openmeet.mvega.pro/ws", "signaling WebSocket URL")
		room     = flag.String("room", "", "room to join straight away")
		inDev    = flag.String("input-device", "", "input device name (skips the picker)")
		outDev   = flag.String("output-device", "", "output device name (skips the picker)")
		listDevs = flag.Bool("list-devices", false, "list audio devices and exit")
		noGate   = flag.Bool("no-voice-gate", false, "transmit continuously instead of only while speaking (saved)")
		bitrate  = flag.Int("audio-kbps", 0, "Opus bitrate (mono); overrides the Audio Send setting for this run")
		complex  = flag.Int("opus-complexity", 0, "Opus encoder complexity 1..10; overrides the setting for this run")
		debug    = flag.Bool("debug", false, "start with the debug panel on")
		profile  = flag.String("cpuprofile", "", "write a CPU profile here until exit")
		version  = flag.Bool("version", false, "print the version and exit")
		headless = flag.Bool("headless", false, "no interface: join --room, log to stdout, quit on ctrl-c (for measuring)")
		noPrio   = flag.Bool("no-priority", false, "leave process and thread priorities alone (for measuring)")
		noVPIO   = flag.Bool("no-voice-processing", false, "macOS: raw devices instead of Apple's voice processing unit")
		vpBypass = flag.Bool("voice-processing-bypass", false, "macOS: keep Apple's unit but skip its echo canceller, gain and noise suppression")
		noVideo  = flag.Bool("no-video", false, "audio-only: no screen sharing, no camera, no windows")
		vidDev   = flag.String("video-device", "", "camera to share (avfoundation index, macOS)")
		testScr  = flag.Bool("test-screen", false, "capture a screen into a preview window and exit")
		testCam  = flag.Bool("test-camera", false, "capture the camera into a preview window and exit")
		noAuto   = flag.Bool("no-auto-update", false, "do not check for or install an update this run")
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

	audio.NoPriority = *noPrio
	audio.NoVoiceProcessing = *noVPIO
	audio.VoiceProcessingBypass = *vpBypass
	// Video needs ffmpeg and ffplay with an H.264 encoder; the room log says why when not.
	videoEnabled, videoWhy := !*noVideo, ""
	switch {
	case *noVideo:
		videoWhy = "--no-video"
	case runtime.GOOS != "darwin" && runtime.GOOS != "windows":
		videoEnabled, videoWhy = false, "unsupported on this OS"
	case !video.Available():
		videoEnabled, videoWhy = false, "ffmpeg and ffplay not found on PATH"
	case video.Encoder() == "":
		videoEnabled, videoWhy = false, "ffmpeg has no H.264 encoder"
	}
	webcamEnabled := videoEnabled && runtime.GOOS == "darwin"
	if *testScr || *testCam {
		if !videoEnabled {
			log.Fatal("video: ", videoWhy)
		}
		if *testScr {
			screens := video.Screens()
			if len(screens) == 0 {
				log.Fatal("no screens found")
			}
			for _, d := range screens {
				log.Printf("screen %s: %s", d.ID, d.Label())
			}
			preview(video.Screen, screens[0])
		} else {
			cams := video.Cameras()
			if len(cams) == 0 {
				log.Fatal("no cameras found")
			}
			d := cams[0]
			for _, c := range cams {
				if *vidDev != "" && c.ID == *vidDev {
					d = c
				}
			}
			preview(video.Webcam, d)
		}
		return
	}

	st := &store{s: settings.Load()}
	// Before anything opens a device: the picker's mic test goes through the same pump as a
	// call does, so it has to be on the path the call will use. A flag still overrides it.
	if !*noVPIO && !*vpBypass {
		audio.NoVoiceProcessing = st.s.AudioProcessing == "raw"
	}
	// Before anything opens a device: the picker's mic test goes through the same pump as a
	// call, so it has to be on the same path the call will use. A flag still overrides it.
	if !*noVPIO && !*vpBypass {
		audio.NoVoiceProcessing = st.s.AudioProcessing == "raw"
	}
	// A silent update announces itself once: the version that ran last is not this one.
	update.CleanupOld()
	justUpdated := st.s.LastRunVersion != nil && *st.s.LastRunVersion != Version && Version != "dev"
	if settings.Str(st.s.LastRunVersion) != Version {
		st.s.LastRunVersion = settings.Ptr(Version)
		_ = settings.Save(st.s)
	}
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
		Screens:    func() []tui.VideoChoice { return choices(video.Screens()) },
		AllCameras: func() []tui.VideoChoice { return choices(video.Cameras()) },
		Cameras: func() []tui.VideoChoice {
			cams := video.Cameras()
			// A camera named on the command line or in settings is the one, not a choice.
			want := *vidDev
			if want == "" {
				want = settings.Str(st.s.VideoDeviceID)
			}
			for _, c := range cams {
				if want != "" && c.ID == want {
					return choices([]video.Device{c})
				}
			}
			return choices(cams)
		},
		Join: func(roomID, name, color, input, output string) (tui.Room, error) {
			// The setting decides the macOS path unless a flag said otherwise for this run.
			if !*noVPIO && !*vpBypass {
				audio.NoVoiceProcessing = st.s.AudioProcessing == "raw"
			}
			// The settings are the call's; each flag is a one-run override of one of them.
			audioBps := st.s.AudioSendKbps * 1000
			if *bitrate > 0 {
				audioBps = *bitrate * 1000
			}
			complexity := st.s.OpusComplexity
			if *complex > 0 {
				complexity = *complex
			}
			e := engine.New(a, engine.Options{
				ServerURL: *server, Room: roomID, Name: name, Color: color,
				Input: dev.find(input, false), Output: dev.find(output, true),
				VoiceGate: st.s.VoiceGate, Bitrate: audioBps, Complex: complexity, Debug: *debug,
				MicLevel:     st.s.MicLevel != "off",
				VideoEnabled: videoEnabled, VideoDisabledWhy: videoWhy, WebcamEnabled: webcamEnabled,
				ScreenSendKbps: st.s.ScreenSendKbps, ScreenUploadKbps: st.s.ScreenUploadKbps,
			}, emit)
			if err := e.Start(); err != nil {
				return nil, err
			}
			return &roomSession{e: e, d: dev}, nil
		},
	}

	if *headless {
		if *room == "" {
			log.Fatal("--headless needs --room")
		}
		log.SetFlags(log.Ltime | log.Lmicroseconds)
		go func() {
			for msg := range events {
				switch m := msg.(type) {
				case tui.DebugLine:
					log.Print(m.Text)
				case tui.Line:
					log.Printf("%s %s", m.Kind, m.Text)
				}
			}
		}()
		r, err := host.Join(*room, st.Name(), st.Color(), dev.Resolve(*inDev, dev.Inputs()), dev.Resolve(*outDev, dev.Outputs()))
		if err != nil {
			log.Fatal(err)
		}
		if !*debug {
			log.Print("headless: use --debug for the pump and playout lines")
		}
		sigc := make(chan os.Signal, 1)
		osSignal.Notify(sigc, os.Interrupt, syscall.SIGTERM)
		<-sigc
		r.Close()
		return
	}
	// The registry, then the download, in the background: the notice appears only when
	// restarting would really install something.
	policy := st.s.AutoUpdate
	if *noAuto {
		policy = "off"
	}
	// Asked at every start, and again whenever someone presses `u` — the difference being
	// that a person asking is told when there is nothing, and a start passes in silence.
	check := func(mode update.Mode) {
		status := update.Check(context.Background(), policy, Version, st, mode, func(string, ...any) {})
		switch {
		case status != nil:
			emit(tui.UpdateAvailable{Version: status.Version, Ready: status.Ready, Command: status.Command})
		case mode == update.Asked:
			emit(tui.UpToDate{})
		}
	}
	go check(update.Startup)
	host.CheckUpdate = func() { check(update.Asked) }
	restart := false
	host.RestartUpdate = func() { restart = true }
	host.JustUpdated = justUpdated

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
	// The app is gone from the terminal and holds nothing: the one moment to swap the binary.
	if update.Pending() != "" && policy == "auto" {
		if err := update.Apply(); err != nil {
			fmt.Fprintln(os.Stderr, "update: could not install the downloaded version:", err)
		} else if restart {
			if err := update.Relaunch(); err != nil {
				fmt.Fprintln(os.Stderr, "update installed; start openmeet again:", err)
			}
		} else {
			fmt.Fprintln(os.Stderr, "update installed; it runs next time you start openmeet")
		}
	}
}
