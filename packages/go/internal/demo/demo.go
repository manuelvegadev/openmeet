// Package demo is the scripted call `--demo` plays: the cast, what they say, what they send
// and how long each of it takes. It is data and a walk over it, with no interface in it and
// no network, because it has two consumers that share nothing else.
//
// The first is the application: `cmd/openmeet` plays it into a live room with no server
// behind it, which is the only honest way to judge how the interface looks and where a
// screenshot comes from.
//
// The second is the website. `internal/tui`'s exporter runs the same script against a canvas
// and writes out what the room drew, so the terminal on the landing page is this room rather
// than a drawing of it. That is why nothing here imports the interface: the exporter lives
// inside package tui, and a package tui imports could not be imported back.
package demo

import "time"

// The cast, and what they are shown as. The colours are NamePalette's, which is what a name
// picked in the profile screen would give them.
const (
	Me         = "mvega"
	MeColor    = "#FACC15"
	Them       = "Mario"
	ThemColor  = "#22D3EE"
	Them2      = "amara"
	Them2Color = "#E879F9"
)

// Room is what the header says.
const Room = "standup"

// Peer is one row of the participants pane. The fields are tui.Peer's, by hand: a plain
// record here is the price of the exporter being able to live inside package tui.
type Peer struct {
	ID, Name, Color string
	Muted           bool
	Screen          bool
	ScreenOpen      bool
	Volume          float64
	RecvKbps        int
	LatencyMs       int
}

// Stats is what the header says about the call. Fields for field `tui.Stats`, by hand, for
// the same reason as Peer above.
type Stats struct {
	SendKbps, RecvKbps int
	RTTMs              int
	LossPercent        float64
}

// Call is the call the header describes, and Elapsed how long it has been going by the time
// the script starts. Here rather than in either consumer, because the application and the
// website's exporter both have to say the same thing about the same room.
func Call() Stats { return Stats{SendKbps: 128, RecvKbps: 2608, RTTMs: 41, LossPercent: 0.2} }

const Elapsed = 22 * time.Minute

// Peers is the room, as it is for the whole script: nobody joins or leaves after the start.
func Peers() []Peer {
	return []Peer{
		{ID: "m", Name: Them, Color: ThemColor, Screen: true, ScreenOpen: true, Volume: 1, RecvKbps: 2480, LatencyMs: 41},
		{ID: "a", Name: Them2, Color: Them2Color, Muted: true, Volume: 0.7, RecvKbps: 128, LatencyMs: 156},
	}
}

// File is a file somebody shares. Kind and State carry tui's own strings — "img", "offered"
// — rather than tui's constants, which is the same trade as Peer above.
type File struct {
	ID    string
	Name  string
	Size  int64
	Kind  string
	From  string
	Mine  bool
	State string
	Saved string
}

// Stage is what the script talks to. The application's stage emits events into the Bubble Tea
// program; the exporter's draws a frame and remembers it.
//
// Wait is the one that reports back: it returns false when whoever is playing the script has
// had enough — the room was left, or the exporter has recorded all it means to ship — and
// every step checks it, so the script stops where it is instead of running to its end.
type Stage interface {
	Snapshot(speaking bool)
	Say(who, colour, text string)
	// Draft is what is in the composer right now, whole. TypeInto calls it once per
	// character, which is the shape the application wants; the website's exporter keeps the
	// first and the last and turns the middle into an animation.
	Draft(text string)
	Event(kind, who, text string)
	Share(who, colour string, f File)
	Update(id, state string, done, rate int64, saved string)
	Toast(kind, text string)
	Wait(d time.Duration) bool
}

// TypeDelay is how long a character takes. Fast enough not to be a wait, slow enough that
// the composer reads as being written in rather than as text appearing.
const TypeDelay = 32 * time.Millisecond

// TypeInto writes a message of yours into the composer a character at a time and sends it.
// The demo types its own messages because a chat application that only ever shows messages
// arriving is showing half of itself.
func TypeInto(s Stage, text string) bool {
	r := []rune(text)
	for i := range r {
		s.Draft(string(r[:i+1]))
		if !s.Wait(TypeDelay) {
			return false
		}
	}
	// A beat with the finished message sitting there, the way a person reads it back.
	if !s.Wait(450 * time.Millisecond) {
		return false
	}
	s.Draft("")
	s.Say(Me, MeColor, text)
	return true
}

// Transfer plays one file moving, at five frames a second, the way a real one reports.
func Transfer(s Stage, id string, size int64, seconds float64, state string) bool {
	const fps = 5
	steps := int(seconds * fps)
	elapsed := time.Duration(0)
	for i := 1; i <= steps; i++ {
		if !s.Wait(time.Second / fps) {
			return false
		}
		elapsed += time.Second / fps
		done := size * int64(i) / int64(steps)
		rate := int64(float64(done) / elapsed.Seconds())
		s.Update(id, state, done, rate, "")
	}
	return true
}

// Run plays the script. It is written as a straight line on purpose: what happens in a call
// is a sequence, and a table of steps would say the same thing with a machine in the way.
func Run(s Stage) {
	s.Snapshot(false)
	if !s.Wait(600 * time.Millisecond) {
		return
	}
	s.Event("join", Them, "joined the room")
	s.Snapshot(false)
	if !s.Wait(900 * time.Millisecond) {
		return
	}
	s.Say(Them, ThemColor, "morning — did the Windows build ever finish?")
	if !s.Wait(1500 * time.Millisecond) {
		return
	}
	s.Snapshot(true)
	if !TypeInto(s, "yeah, four minutes on the i7. the spike at the end is the camera opening") {
		return
	}
	if !s.Wait(700 * time.Millisecond) {
		return
	}
	if !TypeInto(s, "it holds the device for a moment after SIGTERM") {
		return
	}
	s.Snapshot(false)
	if !s.Wait(1200 * time.Millisecond) {
		return
	}
	s.Event("screen", Them, "started screen sharing")
	if !s.Wait(1200 * time.Millisecond) {
		return
	}

	// A file they share and you take.
	s.Share(Them, ThemColor, File{ID: "1", Name: "trace.zip", Size: 4718592, Kind: "zip", From: Them, State: "offered"})
	if !s.Wait(2 * time.Second) {
		return
	}
	s.Update("1", "waiting", 0, 0, "")
	if !s.Wait(600 * time.Millisecond) {
		return
	}
	if !Transfer(s, "1", 4718592, 4, "receiving") {
		return
	}
	s.Update("1", "saved", 4718592, 0, "/Users/mvega/Downloads/openmeet/trace.zip")
	s.Toast("ok", "Saved to /Users/mvega/Downloads/openmeet/trace.zip")
	if !s.Wait(1500 * time.Millisecond) {
		return
	}

	s.Say(Them, ThemColor, "and the capture of the window that froze")
	if !s.Wait(1200 * time.Millisecond) {
		return
	}
	s.Share(Them, ThemColor, File{ID: "2", Name: "captura.png", Size: 298342, Kind: "img", From: Them,
		State: "saved", Saved: "/Users/mvega/Downloads/openmeet/captura.png"})
	if !s.Wait(1500 * time.Millisecond) {
		return
	}

	// And one of yours, big and slow, so the bar and the speed have something to say.
	s.Snapshot(true)
	if !TypeInto(s, "sending you the recording now — it is five gigabytes, so settle in") {
		return
	}
	s.Snapshot(false)
	if !s.Wait(900 * time.Millisecond) {
		return
	}
	s.Share(Me, MeColor, File{ID: "3", Name: "2026-09-09 19-38-33.mov", Size: 5476083302, Kind: "vid",
		From: Me, Mine: true, State: "offered"})
	if !s.Wait(2 * time.Second) {
		return
	}
	s.Event("mute", Them2, "muted")
	if !s.Wait(600 * time.Millisecond) {
		return
	}
	// Slowly, and it keeps going: this is the one you watch.
	for {
		if !Transfer(s, "3", 5476083302, 60, "sending") {
			return
		}
		s.Update("3", "offered", 0, 0, "")
		if !s.Wait(3 * time.Second) {
			return
		}
	}
}
