package tui

import (
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

// The Bubble Tea model: which screen is up, what each one is doing, and the keys — the same
// keys, screen for screen, as the Node client's app.tsx and its components.

type screenID int

const (
	screenProfile screenID = iota
	screenHome
	screenSettings
	screenDevices
	screenRoom
)

// Room is the interface's view of the engine: what it can ask for.
type Room interface {
	ToggleMute()
	SendChat(text string)
	SetVolume(peerID string, v float64)
	ToggleDebug()
	UpdateDevices(in, out string) error
	Close()
}

// Host is what the model needs from the program around it.
type Host struct {
	Version, Platform, Features string
	// Identity and devices persist through these.
	Settings SettingsStore
	Devices  DeviceSource
	// Join opens a room session; events arrive on the channel the host was given.
	Join func(room, name, color, input, output string) (Room, error)
	// Where to start: the room to join straight away, if the CLI said so.
	InitialRoom string
	InputFlag   string
	OutputFlag  string
}

type SettingsStore interface {
	Name() string
	Color() string
	SetIdentity(name, color string)
	InputID() string
	OutputID() string
	DevicesConfigured() bool
	SetDevices(input, output string)
	Rows() []SettingsRow
	// Run the row's action (cycle a value, or say which picker to open: "input"/"output"/"camera"/"profile").
	Run(idx int) string
}

type DeviceSource interface {
	// Names, in the order a picker shows them: the ones that carry effects first.
	Inputs() []string
	Outputs() []string
	// How a device reads in a picker: its name, and what it does for you when it does
	// something ("— GPU noise removal + echo cancellation").
	Label(name string) string
	// A Bluetooth headset: its microphone drops it to the hands-free profile.
	IsBluetooth(name string) bool
	// The mic test: level polling and a tone.
	StartMicTest(input, output string) (MicTest, error)
	// A saved id resolved to a listed name, or "" when none matches.
	Resolve(saved string, list []string) string
}

type MicTest interface {
	Level() float64
	PlayTone()
	Close()
}

// ── messages ────────────────────────────────────────────────────────────────

type tickMsg time.Time
type blinkMsg struct{ gen int }
type armMsg struct {
	kind string
	gen  int
}
type micMsg struct{}

const (
	blinkMs      = 530
	blinkToggles = 10
	armMs        = 2000
)

type textField struct {
	value  string
	cursor int
}

func (f *textField) insert(s string) {
	r := []rune(f.value)
	r = append(r[:f.cursor], append([]rune(s), r[f.cursor:]...)...)
	f.value = string(r)
	f.cursor += len([]rune(s))
}

func (f *textField) backspace() {
	if f.cursor == 0 {
		return
	}
	r := []rune(f.value)
	r = append(r[:f.cursor-1], r[f.cursor:]...)
	f.value = string(r)
	f.cursor--
}

func (f *textField) left()  { f.cursor = max(0, f.cursor-1) }
func (f *textField) right() { f.cursor = min(len([]rune(f.value)), f.cursor+1) }
func (f *textField) clear() { f.value = ""; f.cursor = 0 }

type Model struct {
	host   Host
	width  int
	height int
	screen screenID
	quit   bool

	// blink: one generation per restart, so a stale timer cannot flip the cursor.
	blinkGen   int
	blinkOn    bool
	blinkCount int
	armGen     int

	// home
	joining   bool
	joinField textField
	escArmed  bool

	// profile
	profile      ProfileState
	nameField    textField
	profileFrom  screenID
	profileColor string

	// settings
	settingsIdx    int
	picker         string // "", "input", "output", "camera"
	pickerItems    []string
	pickerIdx      int
	settingsLoaded bool

	// devices (the audio setup, and the room's change-device flow)
	devStep     string
	devTitle    string
	devItems    []string
	devIdx      int
	devInputs   []string
	devOutputs  []string
	devInput    string // chosen names; "" is the system default
	devOutput   string
	mic         MicTest
	micLevel    float64
	pendingRoom string
	devFrom     screenID

	// room
	room       Room
	rs         RoomState
	draft      textField
	anchor     int
	clearArmed bool
	leaveArmed bool
	roomName   string
	debugLines []ChatEntry
}

func New(host Host) *Model {
	m := &Model{host: host, width: 80, height: 24, anchor: -1}
	if host.Settings.Name() == "" || host.Settings.Color() == "" {
		m.screen = screenProfile
		m.profileFrom = screenHome
		m.startProfile("", "", false)
	} else if host.InitialRoom != "" {
		m.enterDevices(host.InitialRoom, screenHome)
	} else {
		m.screen = screenHome
	}
	return m
}

func (m *Model) Init() tea.Cmd { return m.tick() }

func (m *Model) tick() tea.Cmd {
	return tea.Tick(time.Second, func(t time.Time) tea.Msg { return tickMsg(t) })
}

func (m *Model) blink() tea.Cmd {
	m.blinkGen++
	m.blinkOn = true
	m.blinkCount = 0
	gen := m.blinkGen
	return tea.Tick(blinkMs*time.Millisecond, func(time.Time) tea.Msg { return blinkMsg{gen} })
}

func (m *Model) arm(kind string) tea.Cmd {
	m.armGen++
	gen := m.armGen
	return tea.Tick(armMs*time.Millisecond, func(time.Time) tea.Msg { return armMsg{kind, gen} })
}

func micTick() tea.Cmd {
	return tea.Tick(80*time.Millisecond, func(time.Time) tea.Msg { return micMsg{} })
}

// ── update ──────────────────────────────────────────────────────────────────

func (m *Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		return m, nil
	case tickMsg:
		return m, m.tick()
	case blinkMsg:
		if msg.gen != m.blinkGen {
			return m, nil
		}
		m.blinkCount++
		if m.blinkCount > blinkToggles {
			m.blinkOn = true
			return m, nil
		}
		m.blinkOn = !m.blinkOn
		gen := m.blinkGen
		return m, tea.Tick(blinkMs*time.Millisecond, func(time.Time) tea.Msg { return blinkMsg{gen} })
	case armMsg:
		if msg.gen != m.armGen {
			return m, nil
		}
		m.escArmed, m.clearArmed, m.leaveArmed = false, false, false
		return m, nil
	case micMsg:
		if m.mic != nil {
			m.micLevel = m.mic.Level()
			return m, micTick()
		}
		return m, nil
	case Snapshot:
		m.applySnapshot(msg)
		return m, nil
	case Line:
		m.rs.Entries = append(m.rs.Entries, ChatEntry(msg))
		return m, nil
	case DebugLine:
		m.debugLines = append(m.debugLines, ChatEntry(msg))
		if len(m.debugLines) > 200 {
			m.debugLines = m.debugLines[len(m.debugLines)-200:]
		}
		return m, nil
	case Left:
		if m.screen == screenRoom {
			m.rs.Connected = false
			m.rs.Error = msg.Reason
		}
		return m, nil
	case tea.KeyMsg:
		if msg.Type == tea.KeyCtrlC {
			m.leaveRoom()
			m.quit = true
			return m, tea.Quit
		}
		switch m.screen {
		case screenProfile:
			return m, m.keyProfile(msg)
		case screenHome:
			return m, m.keyHome(msg)
		case screenSettings:
			return m, m.keySettings(msg)
		case screenDevices:
			return m, m.keyDevices(msg)
		case screenRoom:
			return m, m.keyRoom(msg)
		}
	}
	return m, nil
}

func (m *Model) applySnapshot(s Snapshot) {
	m.rs.Connected = s.Connected
	m.rs.JoinedAt = s.JoinedAt
	m.rs.Me = s.Me
	// Keep the selection on a peer that still exists.
	m.rs.Peers = s.Peers
	if m.rs.SelectedPeer >= len(s.Peers) {
		m.rs.SelectedPeer = max(0, len(s.Peers)-1)
	}
	m.rs.Stats = s.Stats
	m.rs.Error = s.Error
	m.rs.Debug = s.Debug
}

func isRune(msg tea.KeyMsg, r string) bool {
	return msg.Type == tea.KeyRunes && string(msg.Runes) == r
}

func typed(msg tea.KeyMsg) (string, bool) {
	switch msg.Type {
	case tea.KeyRunes:
		return string(msg.Runes), true
	case tea.KeySpace:
		return " ", true
	}
	return "", false
}

// ── home ────────────────────────────────────────────────────────────────────

func (m *Model) keyHome(msg tea.KeyMsg) tea.Cmd {
	if m.joining {
		switch msg.Type {
		case tea.KeyEsc:
			m.joining = false
			m.joinField.clear()
		case tea.KeyEnter:
			if room := strings.TrimSpace(m.joinField.value); room != "" {
				m.enterDevices(room, screenHome)
				return micTick()
			}
		case tea.KeyBackspace:
			m.joinField.backspace()
			return m.blink()
		case tea.KeyLeft:
			m.joinField.left()
			return m.blink()
		case tea.KeyRight:
			m.joinField.right()
			return m.blink()
		default:
			if s, ok := typed(msg); ok {
				m.joinField.insert(s)
				return m.blink()
			}
		}
		return nil
	}
	switch {
	case msg.Type == tea.KeyEsc:
		if m.escArmed {
			m.quit = true
			return tea.Quit
		}
		m.escArmed = true
		return m.arm("esc")
	case isRune(msg, "j"):
		m.joining = true
		m.joinField.clear()
		return m.blink()
	case isRune(msg, "s"):
		m.screen = screenSettings
		m.settingsIdx = 0
		m.picker = ""
	}
	return nil
}

// ── profile ─────────────────────────────────────────────────────────────────

func (m *Model) startProfile(name, color string, canCancel bool) {
	m.nameField = textField{value: name, cursor: len([]rune(name))}
	m.profileColor = color
	m.profile = ProfileState{Step: "name", Name: name, Finished: FinishName(name), Color: color, CanCancel: canCancel}
	for i, pc := range NamePalette {
		if pc.Hex == color {
			m.profile.ColorIdx = i
		}
	}
}

func (m *Model) keyProfile(msg tea.KeyMsg) tea.Cmd {
	if m.profile.Step == "color" {
		switch msg.Type {
		case tea.KeyEsc:
			m.profile.Step = "name"
		case tea.KeyUp:
			m.profile.ColorIdx = max(0, m.profile.ColorIdx-1)
		case tea.KeyDown:
			m.profile.ColorIdx = min(len(NamePalette)-1, m.profile.ColorIdx+1)
		case tea.KeyEnter:
			m.host.Settings.SetIdentity(m.profile.Finished, NamePalette[m.profile.ColorIdx].Hex)
			m.screen = m.profileFrom
			if m.screen == screenHome && m.host.InitialRoom != "" && m.room == nil {
				m.enterDevices(m.host.InitialRoom, screenHome)
				return micTick()
			}
		}
		return nil
	}
	switch msg.Type {
	case tea.KeyEsc:
		if m.profile.CanCancel {
			m.screen = m.profileFrom
		}
	case tea.KeyEnter:
		if m.profile.Finished != "" {
			m.profile.Step = "color"
		}
	case tea.KeyBackspace:
		m.nameField.backspace()
	case tea.KeyLeft:
		m.nameField.left()
	case tea.KeyRight:
		m.nameField.right()
	default:
		if s, ok := typed(msg); ok {
			m.nameField.insert(s)
			m.nameField.value = ClampName(m.nameField.value)
			m.nameField.cursor = min(m.nameField.cursor, len([]rune(m.nameField.value)))
		} else {
			return nil
		}
	}
	m.profile.Name = m.nameField.value
	m.profile.Finished = FinishName(m.nameField.value)
	return m.blink()
}

// ── settings ────────────────────────────────────────────────────────────────

func (m *Model) keySettings(msg tea.KeyMsg) tea.Cmd {
	if m.picker != "" {
		switch msg.Type {
		case tea.KeyEsc:
			m.picker = ""
		case tea.KeyUp:
			m.pickerIdx = max(0, m.pickerIdx-1)
		case tea.KeyDown:
			m.pickerIdx = min(len(m.pickerItems)-1, m.pickerIdx+1)
		case tea.KeyEnter:
			chosen := ""
			if m.pickerIdx > 0 {
				chosen = m.pickerItems[m.pickerIdx]
			}
			switch m.picker {
			case "input":
				m.host.Settings.SetDevices(chosen, m.host.Settings.OutputID())
			case "output":
				m.host.Settings.SetDevices(m.host.Settings.InputID(), chosen)
			}
			m.picker = ""
		}
		return nil
	}
	rows := m.host.Settings.Rows()
	switch msg.Type {
	case tea.KeyEsc:
		m.screen = screenHome
	case tea.KeyUp:
		m.settingsIdx = max(0, m.settingsIdx-1)
	case tea.KeyDown:
		m.settingsIdx = min(len(rows)-1, m.settingsIdx+1)
	case tea.KeyEnter:
		if m.settingsIdx < len(rows) && !rows[m.settingsIdx].Disabled {
			switch m.host.Settings.Run(m.settingsIdx) {
			case "profile":
				m.profileFrom = screenSettings
				m.startProfile(m.host.Settings.Name(), m.host.Settings.Color(), true)
				m.screen = screenProfile
				return m.blink()
			case "input":
				m.openPicker("input", m.host.Devices.Inputs(), m.host.Settings.InputID())
			case "output":
				m.openPicker("output", m.host.Devices.Outputs(), m.host.Settings.OutputID())
			case "camera":
				m.openPicker("camera", nil, "")
			}
		}
	}
	return nil
}

func (m *Model) openPicker(kind string, devices []string, saved string) {
	m.picker = kind
	if kind == "camera" {
		m.pickerItems = []string{"Default (0)"}
		m.pickerIdx = 0
		return
	}
	m.pickerItems = append([]string{"System Default"}, devices...)
	m.pickerIdx = 0
	if name := m.host.Devices.Resolve(saved, devices); name != "" {
		for i, d := range m.pickerItems {
			if d == name {
				m.pickerIdx = i
			}
		}
	}
}

// ── devices ─────────────────────────────────────────────────────────────────

// enterDevices is the way into a room: through the picker, unless the saved devices are all
// still here — or the CLI named them — in which case straight in.
func (m *Model) enterDevices(room string, from screenID) {
	m.pendingRoom = room
	m.devFrom = from
	m.devInputs = m.host.Devices.Inputs()
	m.devOutputs = m.host.Devices.Outputs()
	if m.host.InputFlag != "" || m.host.OutputFlag != "" {
		m.devInput = m.host.Devices.Resolve(m.host.InputFlag, m.devInputs)
		m.devOutput = m.host.Devices.Resolve(m.host.OutputFlag, m.devOutputs)
		m.joinRoom()
		return
	}
	if m.host.Settings.DevicesConfigured() {
		in, out := m.host.Settings.InputID(), m.host.Settings.OutputID()
		rin, rout := m.host.Devices.Resolve(in, m.devInputs), m.host.Devices.Resolve(out, m.devOutputs)
		if (in == "" || rin != "") && (out == "" || rout != "") {
			m.devInput, m.devOutput = rin, rout
			m.joinRoom()
			return
		}
	}
	m.screen = screenDevices
	m.devTitle = "Audio Setup"
	if len(m.devInputs) == 0 && len(m.devOutputs) == 0 {
		m.devStep = "none"
		return
	}
	m.devStepInput()
}

func (m *Model) devStepInput() {
	m.devStep = "input"
	m.devItems = append([]string{"System Default"}, m.devInputs...)
	m.devIdx = 0
	saved := m.host.Settings.InputID()
	if name := m.host.Devices.Resolve(saved, m.devInputs); name != "" {
		for i, d := range m.devItems {
			if d == name {
				m.devIdx = i
			}
		}
	}
}

func (m *Model) devStepOutput() {
	m.devStep = "output"
	m.devItems = append([]string{"System Default"}, m.devOutputs...)
	m.devIdx = 0
	if name := m.host.Devices.Resolve(m.host.Settings.OutputID(), m.devOutputs); name != "" {
		for i, d := range m.devItems {
			if d == name {
				m.devIdx = i
			}
		}
	}
}

func (m *Model) devStepTest() tea.Cmd {
	m.devStep = "test"
	m.micLevel = 0
	if m.mic != nil {
		m.mic.Close()
	}
	mic, err := m.host.Devices.StartMicTest(m.devInput, m.devOutput)
	if err == nil {
		m.mic = mic
	}
	return micTick()
}

func (m *Model) stopMic() {
	if m.mic != nil {
		m.mic.Close()
		m.mic = nil
	}
}

func (m *Model) keyDevices(msg tea.KeyMsg) tea.Cmd {
	switch m.devStep {
	case "none":
		if msg.Type == tea.KeyEnter {
			m.devInput, m.devOutput = "", ""
			m.joinRoom()
		}
	case "input", "output":
		switch msg.Type {
		case tea.KeyEsc:
			if m.devTitle != "Audio Setup" { // the room's change-device flow can be cancelled
				m.screen = screenRoom
			}
		case tea.KeyUp:
			m.devIdx = max(0, m.devIdx-1)
		case tea.KeyDown:
			m.devIdx = min(len(m.devItems)-1, m.devIdx+1)
		case tea.KeyEnter:
			chosen := ""
			if m.devIdx > 0 {
				chosen = m.devItems[m.devIdx]
			}
			if m.devStep == "input" {
				m.devInput = chosen
				if len(m.devOutputs) == 0 {
					m.devOutput = ""
					return m.devStepTest()
				}
				m.devStepOutput()
			} else {
				m.devOutput = chosen
				return m.devStepTest()
			}
		}
	case "test":
		switch {
		case isRune(msg, "t"):
			if m.mic != nil {
				m.mic.PlayTone()
			}
		case msg.Type == tea.KeyEnter:
			m.stopMic()
			m.host.Settings.SetDevices(m.devInput, m.devOutput)
			if m.devTitle == "Audio Setup" {
				m.joinRoom()
			} else if m.room != nil {
				_ = m.room.UpdateDevices(m.devInput, m.devOutput)
				m.screen = screenRoom
			}
		case msg.Type == tea.KeyEsc:
			m.stopMic()
			m.devStepInput()
		}
	}
	return nil
}

func (m *Model) joinRoom() {
	m.stopMic()
	m.roomName = m.pendingRoom
	m.rs = RoomState{Version: m.host.Version, Platform: m.host.Platform, Room: m.pendingRoom, Anchor: -1, InputFocused: true}
	m.rs.Me = Peer{Name: m.host.Settings.Name(), Color: m.host.Settings.Color(), Volume: 1}
	m.draft.clear()
	m.anchor = -1
	m.debugLines = nil
	m.screen = screenRoom
	room, err := m.host.Join(m.pendingRoom, m.host.Settings.Name(), m.host.Settings.Color(), m.devInput, m.devOutput)
	if err != nil {
		m.rs.Error = err.Error()
		return
	}
	m.room = room
}

func (m *Model) leaveRoom() {
	m.stopMic()
	if m.room != nil {
		m.room.Close()
		m.room = nil
	}
}

// ── room ────────────────────────────────────────────────────────────────────

func (m *Model) keyRoom(msg tea.KeyMsg) tea.Cmd {
	if msg.Type == tea.KeyTab {
		m.rs.InputFocused = !m.rs.InputFocused
		if m.rs.InputFocused {
			return m.blink()
		}
		return nil
	}
	if msg.Type == tea.KeyPgUp {
		m.scroll(-10)
		return nil
	}
	if msg.Type == tea.KeyPgDown {
		m.scroll(10)
		return nil
	}
	if m.rs.InputFocused {
		switch msg.Type {
		case tea.KeyEnter:
			if text := strings.TrimSpace(m.draft.value); text != "" && m.room != nil {
				m.room.SendChat(m.draft.value)
			}
			m.draft.clear()
			m.clearArmed = false
			return m.blink()
		case tea.KeyEsc:
			if m.draft.value == "" {
				return nil
			}
			if m.clearArmed {
				m.draft.clear()
				m.clearArmed = false
				return m.blink()
			}
			m.clearArmed = true
			return m.arm("clear")
		case tea.KeyUp:
			m.scroll(-1)
		case tea.KeyDown:
			m.scroll(1)
		case tea.KeyBackspace:
			m.draft.backspace()
			m.clearArmed = false
			return m.blink()
		case tea.KeyLeft:
			m.draft.left()
			return m.blink()
		case tea.KeyRight:
			m.draft.right()
			return m.blink()
		default:
			if s, ok := typed(msg); ok {
				m.draft.insert(s)
				m.clearArmed = false
				return m.blink()
			}
		}
		return nil
	}
	// The controls.
	if isRune(msg, "q") {
		if m.leaveArmed {
			m.leaveRoom()
			m.leaveArmed = false
			m.screen = screenHome
			m.joining = false
			return nil
		}
		m.leaveArmed = true
		return m.arm("leave")
	}
	m.leaveArmed = false
	switch {
	case isRune(msg, "m"):
		if m.room != nil {
			m.room.ToggleMute()
		}
	case isRune(msg, "d"):
		m.devTitle = "Change Audio Device"
		m.devFrom = screenRoom
		m.devInputs = m.host.Devices.Inputs()
		m.devOutputs = m.host.Devices.Outputs()
		m.screen = screenDevices
		m.devStepInput()
	case isRune(msg, "g"):
		if m.room != nil {
			m.room.ToggleDebug()
		}
	case msg.Type == tea.KeyUp:
		m.rs.SelectedPeer = max(0, m.rs.SelectedPeer-1)
	case msg.Type == tea.KeyDown:
		m.rs.SelectedPeer = min(max(0, len(m.rs.Peers)-1), m.rs.SelectedPeer+1)
	case isRune(msg, "-") || isRune(msg, "["):
		m.nudgeVolume(-0.02)
	case isRune(msg, "+") || isRune(msg, "=") || isRune(msg, "]"):
		m.nudgeVolume(0.02)
	}
	return nil
}

func (m *Model) nudgeVolume(d float64) {
	if m.room == nil || m.rs.SelectedPeer >= len(m.rs.Peers) {
		return
	}
	p := m.rs.Peers[m.rs.SelectedPeer]
	v := float64(int((p.Volume+d)*100+0.5)) / 100
	m.room.SetVolume(p.ID, v)
}

func (m *Model) scroll(delta int) {
	last := len(m.rs.Entries) - 1
	if last < 0 {
		return
	}
	end := last
	if m.anchor >= 0 && m.anchor < last {
		end = m.anchor
	}
	next := max(0, end+delta)
	if next >= last {
		m.anchor = -1
	} else {
		m.anchor = next
	}
}

// ── view ────────────────────────────────────────────────────────────────────

func (m *Model) View() string {
	if m.quit {
		return ""
	}
	c := NewCanvas(max(20, m.width), max(6, m.height))
	switch m.screen {
	case screenProfile:
		m.profile.Cursor = m.blinkOn
		DrawProfile(c, m.profile)
	case screenHome:
		DrawHome(c, HomeState{
			Version: m.host.Version, Platform: m.host.Platform, Features: m.host.Features,
			Name: m.host.Settings.Name(), Color: m.host.Settings.Color(),
			Joining: m.joining, JoinCode: m.joinField.value, Cursor: m.blinkOn, EscArmed: m.escArmed,
		})
	case screenSettings:
		st := SettingsState{Rows: m.host.Settings.Rows(), Selected: m.settingsIdx}
		if m.picker != "" {
			st.PickerTitle = map[string]string{"input": "Audio Input", "output": "Audio Output", "camera": "Camera"}[m.picker]
			st.Picker, st.PickerIdx = m.labels(m.pickerItems), m.pickerIdx
		}
		DrawSettings(c, st)
	case screenDevices:
		in, out := m.devInput, m.devOutput
		if in == "" {
			in = "System Default"
		}
		if out == "" {
			out = "System Default"
		}
		DrawDevices(c, DevicesState{Title: m.devTitle, Step: m.devStep, Items: m.labels(m.devItems), Idx: m.devIdx, Input: in, Output: out, Level: m.micLevel, Hint: m.deviceHint()})
	case screenRoom:
		rs := m.rs
		rs.Now = time.Now()
		rs.Draft, rs.DraftCursor, rs.Cursor = m.draft.value, m.draft.cursor, m.blinkOn
		rs.Anchor = m.anchor
		rs.ClearArmed, rs.LeaveArmed = m.clearArmed, m.leaveArmed
		rs.DebugLines = m.debugLines
		DrawRoom(c, rs)
	}
	return c.Render()
}

// labels turns picker names into what the rows say; the first entry is the system default.
func (m *Model) labels(names []string) []string {
	out := make([]string, len(names))
	for i, n := range names {
		if i == 0 || n == "System Default" || n == "Default (0)" {
			out[i] = n
		} else {
			out[i] = m.host.Devices.Label(n)
		}
	}
	return out
}

// deviceHint is the line under a picker: the Bluetooth note once the chosen microphone and
// speaker are the same headset — its microphone drops it to the hands-free profile, and the
// computer's microphone would keep it in full quality.
func (m *Model) deviceHint() string {
	if m.devStep != "output" && m.devStep != "test" {
		return ""
	}
	if m.devInput == "" || !m.host.Devices.IsBluetooth(m.devInput) {
		return ""
	}
	if m.devStep == "output" || (m.devOutput != "" && m.host.Devices.IsBluetooth(m.devOutput)) {
		return "A Bluetooth headset's microphone puts it in the hands-free profile: mono, 16 kHz, both ways. This computer's own microphone as the input keeps the headset in full quality."
	}
	return ""
}
