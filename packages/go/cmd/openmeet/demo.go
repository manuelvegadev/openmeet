package main

import (
	"time"

	"github.com/manuelvegadev/openmeet/packages/go/internal/demo"
	"github.com/manuelvegadev/openmeet/packages/go/internal/tui"
)

// `--demo` is the room with nobody in it: a scripted call, no server, no devices, no
// network. It exists because the only honest way to judge how the interface looks is to look
// at the interface — a page drawn to resemble it is a drawing, and the difference is always
// in the part you were trying to judge.
//
// It is also what a screenshot comes from, and how the conversation can be worked on without
// a second machine and somebody at it.
//
// The script itself is `internal/demo`, because the website's terminal is this same call
// replayed against a canvas. What is here is the half that needs a running program: turning
// each step into an event the interface will be handed.

type demoRoom struct {
	emit func(interface{})
	stop chan struct{}
}

// demoRoom is the script's stage while the application is playing it.
var _ demo.Stage = (*demoRoom)(nil)

func demoPeers() []tui.Peer {
	out := make([]tui.Peer, 0, len(demo.Peers()))
	for _, p := range demo.Peers() {
		out = append(out, tui.Peer{ID: p.ID, Name: p.Name, Color: p.Color, Muted: p.Muted,
			Screen: p.Screen, ScreenOpen: p.ScreenOpen, Volume: p.Volume,
			RecvKbps: p.RecvKbps, LatencyMs: p.LatencyMs})
	}
	return out
}

func (d *demoRoom) Snapshot(speaking bool) {
	st := demo.Call()
	d.emit(tui.Snapshot{
		Connected: true, JoinedAt: time.Now().Add(-demo.Elapsed),
		Me:           tui.Peer{Name: demo.Me, Color: demo.MeColor, Speaking: speaking},
		Peers:        demoPeers(),
		Stats:        &tui.Stats{SendKbps: st.SendKbps, RecvKbps: st.RecvKbps, RTTMs: st.RTTMs, LossPercent: st.LossPercent},
		VideoEnabled: true, WebcamEnabled: true,
	})
}

func (d *demoRoom) Say(who, colour, text string) {
	d.emit(tui.Line{At: time.Now(), Kind: tui.KindMessage, Who: who, Color: colour, Text: text})
}

func (d *demoRoom) Draft(text string) {
	d.emit(tui.Draft{Text: text})
}

func (d *demoRoom) Event(kind, who, text string) {
	d.emit(tui.Line{At: time.Now(), Kind: tui.EntryKind(kind), Who: who, Text: text})
}

func (d *demoRoom) Share(who, colour string, f demo.File) {
	d.emit(tui.FileShared{At: time.Now(), Who: who, Color: colour, File: tui.FileInfo{
		ID: f.ID, Name: f.Name, Size: f.Size, Kind: f.Kind, From: f.From, Mine: f.Mine,
		State: f.State, Saved: f.Saved,
	}})
}

func (d *demoRoom) Update(id, state string, done, rate int64, saved string) {
	d.emit(tui.FileUpdate{ID: id, State: state, Done: done, Rate: rate, Saved: saved})
}

func (d *demoRoom) Toast(kind, text string) {
	d.emit(tui.Toast{Kind: kind, Text: text})
}

// Wait sleeps unless the room has been left, so quitting the demo does not hang on its script.
func (d *demoRoom) Wait(s time.Duration) bool {
	select {
	case <-d.stop:
		return false
	case <-time.After(s):
		return true
	}
}

// ── what the interface can ask of it ────────────────────────────────────────

func (d *demoRoom) ToggleMute()                        {}
func (d *demoRoom) SendChat(text string)               { d.Say(demo.Me, demo.MeColor, text) }
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
	d.Share(demo.Me, demo.MeColor, demo.File{ID: path, Name: shortName(path), Size: 1048576,
		Kind: "doc", From: demo.Me, Mine: true, State: tui.FileOffered})
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
	go demo.Run(d)
	return d, nil
}
