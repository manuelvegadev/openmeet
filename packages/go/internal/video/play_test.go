package video

import (
	"testing"
	"time"
)

// A pipe nobody reads. ffplay becomes this when it wedges, and the whole point of the queue
// is that the rest of the application does not notice.
type deafPipe struct{ closed chan struct{} }

func newDeafPipe() *deafPipe { return &deafPipe{closed: make(chan struct{})} }

func (d *deafPipe) Write(p []byte) (int, error) {
	<-d.closed // exactly what a full pipe does: never returns
	return 0, errClosed
}
func (d *deafPipe) Close() error {
	select {
	case <-d.closed:
	default:
		close(d.closed)
	}
	return nil
}

var errClosed = errTest("pipe closed")

type errTest string

func (e errTest) Error() string { return string(e) }

func stuckPlayer() (*Player, *deafPipe) {
	pipe := newDeafPipe()
	p := &Player{title: "test", in: pipe, queue: make(chan []byte, playerQueue), lastWrite: time.Now()}
	go p.pump()
	return p, pipe
}

func frame(key bool) []byte {
	nal := byte(1) // a non-IDR slice
	if key {
		nal = 5
	}
	return []byte{0, 0, 0, 1, nal, 0xAA, 0xBB}
}

// The one that wedged a room: a player that stops reading must not stop anything else. This
// used to block inside Write with the mutex held, so Close, Closed and Frames all waited on
// a pipe that was never going to move.
func TestAPlayerThatStopsReadingStopsNothingElse(t *testing.T) {
	p, pipe := stuckPlayer()
	defer pipe.Close()

	done := make(chan struct{})
	go func() {
		// Far more than the queue holds: none of these may wait.
		for i := 0; i < playerQueue*4; i++ {
			p.Write(frame(i%30 == 0))
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Write blocked on a player that stopped reading")
	}

	// And the things a room asks about it answer straight away.
	for _, c := range []struct {
		name string
		call func()
	}{
		{"Closed", func() { p.Closed() }},
		{"Frames", func() { p.Frames() }},
		{"Stalled", func() { p.Stalled() }},
		{"Close", func() { p.Close() }},
	} {
		ok := make(chan struct{})
		go func() { c.call(); close(ok) }()
		select {
		case <-ok:
		case <-time.After(2 * time.Second):
			t.Fatalf("%s blocked", c.name)
		}
	}
}

// What a stalled player costs is frames, and it loses them up to a keyframe so the picture
// comes back whole rather than as half of one over the wreck of the last.
func TestAFullQueueWaitsForAKeyframe(t *testing.T) {
	p, pipe := stuckPlayer()
	defer pipe.Close()
	for i := 0; i < playerQueue*2; i++ {
		p.Write(frame(false))
	}
	if n := len(p.queue); n != 0 {
		t.Errorf("the queue kept %d frames nobody can decode", n)
	}
	if !p.Stalled() {
		t.Error("it does not know it is behind")
	}
	p.Write(frame(true))
	if n := len(p.queue); n != 1 {
		t.Errorf("the keyframe did not get in: %d queued", n)
	}
}

// Given up on entirely once nothing has moved for long enough — a wedged window is closed
// and said out loud, rather than left there refusing to close.
func TestAPlayerThatNeverMovesIsGivenUpOn(t *testing.T) {
	p, pipe := stuckPlayer()
	defer pipe.Close()
	p.mu.Lock()
	p.lastWrite = time.Now().Add(-playerStallFor - time.Second)
	p.mu.Unlock()
	for i := 0; i < playerQueue*2; i++ {
		if !p.Write(frame(false)) {
			if !p.Closed() {
				t.Error("it said no without closing the player")
			}
			return
		}
	}
	t.Error("it never gave up")
}

func TestIsKeyframe(t *testing.T) {
	for _, nal := range []byte{5, 7, 8} {
		if !isKeyframe([]byte{0, 0, 0, 1, nal}) {
			t.Errorf("NAL %d is a place a decoder can start", nal)
		}
	}
	for _, nal := range []byte{1, 6, 9} {
		if isKeyframe([]byte{0, 0, 0, 1, nal}) {
			t.Errorf("NAL %d is not", nal)
		}
	}
	// Three-byte start codes too, which is what an encoder mixes in.
	if !isKeyframe([]byte{0, 0, 1, 5, 0xAA}) {
		t.Error("a three-byte start code was missed")
	}
}
