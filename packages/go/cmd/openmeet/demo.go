package main

import (
	"time"

	"github.com/manuelvegadev/openmeet/packages/go/internal/tui"
)

// `--demo` is the room with nobody in it: a scripted call, no server, no devices, no
// network. It exists because the only honest way to judge how the interface looks is to look
// at the interface — a page drawn to resemble it is a drawing, and the difference is always
// in the part you were trying to judge.
//
// It is also what a screenshot comes from, and how the conversation can be worked on without
// a second machine and somebody at it.

type demoRoom struct {
	emit func(interface{})
	stop chan struct{}
}

// The cast, and what they are shown as.
const (
	demoMe     = "mvega"
	demoMeCol  = "#FACC15"
	demoTheirs = "Mario"
	demoTheir2 = "amara"
)

func demoPeers() []tui.Peer {
	return []tui.Peer{
		{ID: "m", Name: demoTheirs, Color: "#22D3EE", Screen: true, ScreenOpen: true, Volume: 1, RecvKbps: 2480, LatencyMs: 41},
		{ID: "a", Name: demoTheir2, Color: "#E879F9", Muted: true, Volume: 0.7, RecvKbps: 128, LatencyMs: 156},
	}
}

func (d *demoRoom) snapshot(speaking bool) {
	d.emit(tui.Snapshot{
		Connected: true, JoinedAt: time.Now().Add(-22 * time.Minute),
		Me:           tui.Peer{Name: demoMe, Color: demoMeCol, Speaking: speaking},
		Peers:        demoPeers(),
		Stats:        &tui.Stats{SendKbps: 128, RecvKbps: 2608, RTTMs: 41, LossPercent: 0.2},
		VideoEnabled: true, WebcamEnabled: true,
	})
}

func (d *demoRoom) say(who, colour, text string) {
	d.emit(tui.Line{At: time.Now(), Kind: tui.KindMessage, Who: who, Color: colour, Text: text})
}

func (d *demoRoom) event(kind tui.EntryKind, who, text string) {
	d.emit(tui.Line{At: time.Now(), Kind: kind, Who: who, Text: text})
}

// wait sleeps unless the room has been left, so quitting the demo does not hang on its script.
func (d *demoRoom) wait(s time.Duration) bool {
	select {
	case <-d.stop:
		return false
	case <-time.After(s):
		return true
	}
}

// transfer plays one file moving, at five frames a second, the way a real one reports.
func (d *demoRoom) transfer(id string, size int64, seconds float64, state string) bool {
	const fps = 5
	steps := int(seconds * fps)
	start := time.Now()
	for i := 1; i <= steps; i++ {
		if !d.wait(time.Second / fps) {
			return false
		}
		done := size * int64(i) / int64(steps)
		rate := int64(float64(done) / time.Since(start).Seconds())
		d.emit(tui.FileUpdate{ID: id, State: state, Done: done, Rate: rate})
	}
	return true
}

func (d *demoRoom) script() {
	them, theirCol := demoTheirs, "#22D3EE"
	d.snapshot(false)
	if !d.wait(600 * time.Millisecond) {
		return
	}
	d.event(tui.KindJoin, them, "joined the room")
	d.snapshot(false)
	if !d.wait(900 * time.Millisecond) {
		return
	}
	d.say(them, theirCol, "morning — did the Windows build ever finish?")
	if !d.wait(1500 * time.Millisecond) {
		return
	}
	d.snapshot(true)
	d.say(demoMe, demoMeCol, "yeah, four minutes on the i7. the spike at the end is the camera opening")
	if !d.wait(700 * time.Millisecond) {
		return
	}
	d.say(demoMe, demoMeCol, "it holds the device for a moment after SIGTERM")
	d.snapshot(false)
	if !d.wait(1200 * time.Millisecond) {
		return
	}
	d.event(tui.KindScreen, them, "started screen sharing")
	if !d.wait(1200 * time.Millisecond) {
		return
	}

	// A file they share and you take.
	d.emit(tui.FileShared{At: time.Now(), Who: them, Color: theirCol, File: tui.FileInfo{
		ID: "1", Name: "trace.zip", Size: 4718592, Kind: "zip", From: them, State: tui.FileOffered,
	}})
	if !d.wait(2 * time.Second) {
		return
	}
	d.emit(tui.FileUpdate{ID: "1", State: tui.FileWaiting})
	if !d.wait(600 * time.Millisecond) {
		return
	}
	if !d.transfer("1", 4718592, 4, tui.FileReceiving) {
		return
	}
	d.emit(tui.FileUpdate{ID: "1", State: tui.FileSaved, Done: 4718592,
		Saved: "/Users/mvega/Downloads/openmeet/trace.zip"})
	d.emit(tui.Toast{Kind: "ok", Text: "Saved to /Users/mvega/Downloads/openmeet/trace.zip"})
	if !d.wait(1500 * time.Millisecond) {
		return
	}

	d.say(them, theirCol, "and the capture of the window that froze")
	if !d.wait(1200 * time.Millisecond) {
		return
	}
	d.emit(tui.FileShared{At: time.Now(), Who: them, Color: theirCol, File: tui.FileInfo{
		ID: "2", Name: "captura.png", Size: 298342, Kind: "img", From: them, State: tui.FileSaved,
		Saved: "/Users/mvega/Downloads/openmeet/captura.png",
	}})
	if !d.wait(1500 * time.Millisecond) {
		return
	}

	// And one of yours, big and slow, so the bar and the speed have something to say.
	d.snapshot(true)
	d.say(demoMe, demoMeCol, "sending you the recording now — it is five gigabytes, so settle in")
	d.snapshot(false)
	if !d.wait(900 * time.Millisecond) {
		return
	}
	d.emit(tui.FileShared{At: time.Now(), Who: demoMe, Color: demoMeCol, File: tui.FileInfo{
		ID: "3", Name: "2026-09-09 19-38-33.mov", Size: 5476083302, Kind: "vid",
		From: demoMe, Mine: true, State: tui.FileOffered,
	}})
	if !d.wait(2 * time.Second) {
		return
	}
	d.event(tui.KindMute, demoTheir2, "muted")
	if !d.wait(600 * time.Millisecond) {
		return
	}
	// Slowly, and it keeps going: this is the one you watch.
	for {
		if !d.transfer("3", 5476083302, 60, tui.FileSending) {
			return
		}
		d.emit(tui.FileUpdate{ID: "3", State: tui.FileOffered})
		if !d.wait(3 * time.Second) {
			return
		}
	}
}

// ── what the interface can ask of it ────────────────────────────────────────

func (d *demoRoom) ToggleMute()                        {}
func (d *demoRoom) SendChat(text string)               { d.say(demoMe, demoMeCol, text) }
func (d *demoRoom) SetVolume(string, float64)          {}
func (d *demoRoom) ToggleDebug()                       {}
func (d *demoRoom) UpdateDevices(_, _ string) error    { return nil }
func (d *demoRoom) StartScreen(string) error           { return nil }
func (d *demoRoom) StopScreen()                        {}
func (d *demoRoom) StartCamera(string) error           { return nil }
func (d *demoRoom) StopCamera()                        {}
func (d *demoRoom) TogglePeerWindow(_, _ string) error { return nil }
func (d *demoRoom) GetFile(string) error               { return nil }
func (d *demoRoom) OpenFile(_, _ string) error         { return nil }
func (d *demoRoom) ShareFile(path string) error {
	d.emit(tui.FileShared{At: time.Now(), Who: demoMe, Color: demoMeCol, File: tui.FileInfo{
		ID: path, Name: shortName(path), Size: 1048576, Kind: "doc", From: demoMe, Mine: true,
		State: tui.FileOffered,
	}})
	return nil
}
func (d *demoRoom) Close() { close(d.stop) }

func shortName(p string) string {
	for i := len(p) - 1; i >= 0; i-- {
		if p[i] == '/' || p[i] == '\\' {
			return p[i+1:]
		}
	}
	return p
}

// startDemo is the Join a demo host uses: no dialling, no devices, just the script.
func startDemo(emit func(interface{})) (tui.Room, error) {
	d := &demoRoom{emit: emit, stop: make(chan struct{})}
	go d.script()
	return d, nil
}
