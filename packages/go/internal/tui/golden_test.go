package tui

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"
)

// The frames in testdata were captured from the Node client at 120x34 (see scripts in the
// migration notes): each screen here must come out cell for cell the same.

func golden(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile("testdata/" + name + ".txt")
	if err != nil {
		t.Skip("no reference frame: " + name)
	}
	return strings.TrimRight(string(b), "\n")
}

func compare(t *testing.T, name string, c *Canvas) {
	t.Helper()
	want := strings.Split(golden(t, name), "\n")
	got := strings.Split(c.Text(), "\n")
	for i := 0; i < len(want) || i < len(got); i++ {
		var w, g string
		if i < len(want) {
			w = strings.TrimRight(want[i], " ")
		}
		if i < len(got) {
			g = strings.TrimRight(got[i], " ")
		}
		if w != g {
			t.Errorf("%s row %d differs\nwant: %q\ngot:  %q", name, i, w, g)
		}
	}
}

func TestHomeMatchesNode(t *testing.T) {
	c := NewCanvas(120, 34)
	DrawHome(c, HomeState{Version: "0.5.2", Platform: "macOS", Features: "audio, chat, video, screen share", Name: "mvega", Color: "#A3E635"})
	compare(t, "home", c)
}

func TestJoinMatchesNode(t *testing.T) {
	c := NewCanvas(120, 34)
	DrawHome(c, HomeState{Version: "0.5.2", Platform: "macOS", Features: "audio, chat, video, screen share", Name: "mvega", Color: "#A3E635", Joining: true, Cursor: true})
	compare(t, "join", c)
}

// The settings are the one screen that has deliberately left the Node client's design: it
// grew sections and the cost/quality bars, so its reference frame is our own rather than a
// capture of Ink. Everything else here is still Node's, cell for cell.
func settingsPose() ([]SettingsRow, []Meter, []Meter) {
	rows := []SettingsRow{
		{Tab: "Audio", Label: "Audio Input", Value: "Roland: STREAM (BRIDGE CAST X V2-II)",
			Help: "Where your voice is taken from. Devices that carry their own effects are offered first."},
		{Tab: "Audio", Label: "Audio Output", Value: "Roland: CHAT (BRIDGE CAST X V2-II)", Help: "Where the room is played back."},
		{Tab: "Audio", Label: "Audio Processing", Choices: []string{"Apple", "Off"}, Choice: 0,
			Help: "Apple's voice processing unit: Voice Isolation, echo cancellation and gain, for about a tenth of a core."},
		{Tab: "Audio", Label: "Mic Level", Choices: []string{"Auto", "Off"}, Choice: 0,
			Help: "Levels your voice, up to +18 dB, so you arrive as loud as everyone else."},
		{Tab: "Audio", Label: "Voice Gate", Choices: []string{"On", "Off"}, Choice: 0,
			Help: "While you are silent nothing is encoded, sent or decoded anywhere in the room."},
		{Tab: "Audio", Label: "Audio Send", Choices: []string{"64", "96", "128", "192", "256"}, Choice: 2, Suffix: "kbps",
			Help: "What the one Opus encoder spends. It encodes once for the whole room."},
		{Tab: "Video", Label: "Camera", Value: "Default (0)", Help: "Which camera a share uses."},
		{Tab: "Video", Label: "Screen Send", Choices: []string{"1000", "1500", "2500", "4000", "6000", "10000"}, Choice: 2,
			Suffix: "kbps at 1080p, split between the people watching", Help: "The ceiling for a screen share."},
		{Tab: "Advanced", Label: "Opus Complexity", Choices: []string{"1", "3", "5", "8", "10"}, Choice: 4,
			Help: "How hard the encoder works for the same bitrate: 10 is the best sound per kbps and the most CPU, 1 the cheapest."},
		{Tab: "Other", Label: "Profile", Value: "[mvega]", ValueColor: "#A3E635", Help: "Your name and colour, as everyone in the room sees them."},
		{Tab: "Other", Label: "Updates", Choices: []string{"install on exit", "tell me", "do not check"}, Choice: 0,
			Help: "A newer version is looked for once a day and downloaded before it is offered."},
	}
	audio := []Meter{
		{Label: "CPU", Fill: 0.68, Note: "Apple + level"},
		{Label: "Network", Fill: 0.225, Note: "128 kbps while you talk, nothing while you do not"},
		{Label: "Quality", Fill: 0.87, Note: "Opus 128 kbps", Good: true},
	}
	video := []Meter{
		{Label: "CPU", Fill: 0.30, Note: "h264_videotoolbox"},
		{Label: "Network", Fill: 0.25, Note: "up to 2500 kbps per peer"},
		{Label: "Quality", Fill: 0.4166, Note: "at 1080p30", Good: true},
	}
	return rows, audio, video
}

func TestSettingsFrame(t *testing.T) {
	rows, audioMeters, videoMeters := settingsPose()
	c := NewCanvas(120, 34)
	DrawSettings(c, SettingsState{Rows: rows, Selected: 2, Tabs: settingsTabs(rows), Tab: 0, Meters: audioMeters})
	compare(t, "settings", c)
	c = NewCanvas(120, 34)
	DrawSettings(c, SettingsState{Rows: rows, Selected: 6, Tabs: settingsTabs(rows), Tab: 1, Meters: videoMeters})
	compare(t, "settings-video", c)
	// The device pickers are a panel over the screen, not a screen instead of it.
	c = NewCanvas(120, 34)
	DrawSettings(c, SettingsState{Rows: rows, Selected: 0, Tabs: settingsTabs(rows), Tab: 0, Meters: audioMeters,
		PickerTitle: "Audio Input", Picker: []string{"System Default", "Wave Link MicrophoneFX — effects", "MIC (BRIDGE CAST X V2-II)"}, PickerIdx: 2})
	compare(t, "settings-picker", c)
}

func TestProfileMatchesNode(t *testing.T) {
	c := NewCanvas(120, 34)
	DrawProfile(c, ProfileState{Step: "name", Name: "mvega", Finished: "mvega", Color: "#A3E635", Cursor: true, CanCancel: true})
	compare(t, "profile", c)
	c = NewCanvas(120, 34)
	DrawProfile(c, ProfileState{Step: "color", Name: "mvega", Finished: "mvega", Color: "#A3E635", ColorIdx: 4, CanCancel: true})
	compare(t, "colour", c)
}

// The pose: scripts/pose.tsx's call, at the moment testdata/room.txt was captured.
func poseRoom() RoomState {
	type line struct {
		kind EntryKind
		who  string
		text string
	}
	people := map[string][2]string{
		"me": {"mvega", "#FACC15"}, "sofia": {"sofia", "#22D3EE"}, "diego": {"diego", "#4ADE80"}, "amara": {"amara", "#E879F9"},
	}
	script := []line{
		{KindJoin, "me", "joined the room"},
		{KindJoin, "sofia", "joined the room"},
		{KindMessage, "sofia", "morning — did the Windows build ever finish?"},
		{KindMessage, "me", "yeah, four minutes on the i7. rebuilding wrtc is most of it"},
		{KindJoin, "diego", "joined the room"},
		{KindMessage, "diego", "hey. audio is clean on my end this time, no robot voice"},
		{KindMessage, "sofia", "good. the dropouts are gone on my side too"},
		{KindMessage, "sofia", "let me put the trace up"},
		{KindScreen, "sofia", "started screen sharing"},
		{KindMessage, "me", "that spike at the end is the camera opening — it holds the device for a moment after SIGTERM, which is why a preview right after a call used to fail"},
		{KindMessage, "diego", "so we wait for the exit instead of a timer?"},
		{KindMessage, "me", "already in — stopCapture only resolves once the grabber is really gone"},
		{KindJoin, "amara", "joined the room"},
		{KindMessage, "amara", "sorry, late. my mic was on the wrong device again"},
		{KindMute, "amara", "muted"},
		{KindMessage, "sofia", "no worries, we are still on the capture path"},
		{KindMessage, "diego", "looks good to me"},
		{KindMessage, "me", "one more pass on the docs and I will tag it"},
	}
	started := time.Date(2026, 9, 11, 14, 51, 50, 0, time.Local)
	var entries []ChatEntry
	for i, l := range script {
		at := started.Add(time.Duration(float64(i)/float64(len(script))*22*60*1000+0.5) * time.Millisecond)
		p := people[l.who]
		entries = append(entries, ChatEntry{At: at, Kind: l.kind, Who: p[0], Color: p[1], Text: l.text})
	}
	return RoomState{
		Version: "0.5.2", Platform: "macOS", Room: "standup", Connected: true,
		JoinedAt: started, Now: started.Add(23 * time.Minute),
		Stats:        &Stats{SendKbps: 128, RecvKbps: 384, RTTMs: 18},
		Me:           Peer{Name: "mvega", Color: "#FACC15", CamOn: true},
		VideoEnabled: true, WebcamEnabled: true,
		Peers: []Peer{
			{ID: "sofia", Name: "sofia", Color: "#22D3EE", Speaking: true, Screen: true, ScreenOpen: true, Volume: 1, RecvKbps: 384, LatencyMs: 38},
			{ID: "diego", Name: "diego", Color: "#4ADE80", CamOn: true, CamOpen: true, Volume: 1, RecvKbps: 128, LatencyMs: 96},
			{ID: "amara", Name: "amara", Color: "#E879F9", Muted: true, Volume: 0.7, RecvKbps: 128, LatencyMs: 155},
		},
		Entries: entries, Anchor: -1,
	}
}

func TestRoomMatchesNode(t *testing.T) {
	c := NewCanvas(120, 34)
	DrawRoom(c, poseRoom())
	compare(t, "room", c)
}

// The colours too: every cell where Node set a foreground or background, ours must match.
// Bold is compared where Node set it. A cell Node left at the terminal default is skipped —
// Ink paints the whole frame, so those are the rare cells of no consequence.
func compareColors(t *testing.T, name string, c *Canvas) {
	t.Helper()
	b, err := os.ReadFile("testdata/" + name + ".json")
	if err != nil {
		t.Skip("no colour reference: " + name)
	}
	var grid [][][]interface{}
	if err := json.Unmarshal(b, &grid); err != nil {
		t.Fatal(err)
	}
	mismatches := 0
	for y, row := range grid {
		for x, cell := range row {
			if y >= c.H || x >= c.W {
				continue
			}
			ch, _ := cell[0].(string)
			if ch == "" || (ch == " " && cell[2] == nil) {
				continue
			}
			got := c.StyleAt(x, y)
			gotFG, gotBG := got.FG, got.BG
			if gotFG == "" {
				gotFG = ThemeText
			}
			if gotBG == "" {
				gotBG = ThemeBG
			}
			wantFG, _ := cell[1].(string)
			wantBG, _ := cell[2].(string)
			wantBold, _ := cell[3].(bool)
			// A blank's foreground is invisible; its background is not.
			fgWrong := ch != " " && wantFG != "" && !strings.EqualFold(wantFG, gotFG)
			bgWrong := wantBG != "" && !strings.EqualFold(wantBG, gotBG)
			if fgWrong || bgWrong || (ch != " " && wantBold != got.Bold) {
				if mismatches < 12 {
					t.Errorf("%s (%d,%d) %q: want fg %s bg %s bold %v, got fg %s bg %s bold %v", name, x, y, ch, wantFG, wantBG, wantBold, gotFG, gotBG, got.Bold)
				}
				mismatches++
			}
		}
	}
	if mismatches > 12 {
		t.Errorf("%s: %d colour mismatches", name, mismatches)
	}
}

func TestColorsMatchNode(t *testing.T) {
	c := NewCanvas(120, 34)
	DrawHome(c, HomeState{Version: "0.5.2", Platform: "macOS", Features: "audio, chat, video, screen share", Name: "mvega", Color: "#A3E635"})
	compareColors(t, "home", c)
	c = NewCanvas(120, 34)
	DrawRoom(c, poseRoom())
	compareColors(t, "room", c)
	c = NewCanvas(120, 34)
	DrawProfile(c, ProfileState{Step: "color", Name: "mvega", Finished: "mvega", Color: "#A3E635", ColorIdx: 4, CanCancel: true})
	compareColors(t, "colour", c)
}
