package audio

import (
	"math"
	"testing"
	"time"

	"github.com/pion/rtp"
	"gopkg.in/hraban/opus.v2"
)

// A sender with a clock of its own: 20 ms Opus packets of a tone, with in-band FEC on so a
// receiver can rebuild a lost frame from the one after it. `quiet` frames are silence.
type sender struct {
	t    *testing.T
	enc  *opus.Encoder
	seq  uint16
	ts   uint32
	buf  []byte
	tone []int16
}

func newSender(t *testing.T) *sender {
	enc, err := opus.NewEncoder(SampleRate, 1, opus.AppVoIP)
	if err != nil {
		t.Fatal(err)
	}
	_ = enc.SetBitrate(64000)
	_ = enc.SetInBandFEC(true)
	_ = enc.SetPacketLossPerc(20)
	tone := make([]int16, FrameLen)
	for i := range tone {
		tone[i] = int16(8000 * math.Sin(2*math.Pi*440*float64(i)/SampleRate))
	}
	return &sender{t: t, enc: enc, buf: make([]byte, 1500), tone: tone}
}

func (s *sender) packet(quiet bool) *rtp.Packet {
	pcm := s.tone
	if quiet {
		pcm = make([]int16, FrameLen)
	}
	n, err := s.enc.Encode(pcm, s.buf)
	if err != nil {
		s.t.Fatal(err)
	}
	payload := make([]byte, n)
	copy(payload, s.buf[:n])
	s.seq++
	s.ts += FrameLen
	return &rtp.Packet{Header: rtp.Header{SequenceNumber: s.seq, Timestamp: s.ts}, Payload: payload}
}

// A receiver on a fake clock, pulling 10 ms at a time like the pump does.
type rig struct {
	p   *Playout
	now time.Time
	out []int16
	// how many 10 ms pieces were audible (tone) and how many silent
	loud, silent int
}

func newRig(t *testing.T) *rig {
	r := &rig{p: NewPlayout(nil), now: time.Unix(1_700_000_000, 0), out: make([]int16, SampleRate/100*OutChannels)}
	r.p.now = func() time.Time { return r.now }
	if err := r.p.AddPeer("a"); err != nil {
		t.Fatal(err)
	}
	return r
}

// tick advances 10 ms and pulls one piece of playback.
func (r *rig) tick() {
	r.now = r.now.Add(10 * time.Millisecond)
	r.p.Fill(r.out)
	if RMS(r.out) > 1000 {
		r.loud++
	} else {
		r.silent++
	}
}

func TestSteadyStreamPlaysCleanly(t *testing.T) {
	s, r := newSender(t), newRig(t)
	for i := 0; i < 250; i++ { // 5 s
		r.p.Push("a", s.packet(false))
		r.tick()
		r.tick()
	}
	st := r.p.Stats("a")
	if st.Concealed != 0 || st.Recovered != 0 || st.Dropped != 0 || st.Skipped != 0 {
		t.Fatalf("a clean stream was repaired: %+v", st)
	}
	if st.Underruns != 0 {
		t.Fatalf("a clean stream underran: %+v", st)
	}
	if r.loud < 470 { // everything but the prefill
		t.Fatalf("only %d of 500 pieces were audible", r.loud)
	}
}

func TestBurstAtStartIsAbsorbedInSilence(t *testing.T) {
	s, r := newSender(t), newRig(t)
	// libwebrtc's habit: a second of packets in a heap, then a steady 50/s, with the
	// speech in bursts that leave quiet frames between them.
	for i := 0; i < 50; i++ {
		r.p.Push("a", s.packet(false))
	}
	for i := 0; i < 500; i++ { // 10 s
		quiet := (i/25)%2 == 1 // half a second of tone, half a second of quiet
		r.p.Push("a", s.packet(quiet))
		r.tick()
		r.tick()
	}
	st := r.p.Stats("a")
	if st.Dropped != 0 {
		t.Fatalf("caught up by dropping speech: %+v", st)
	}
	if st.Skipped == 0 {
		t.Fatalf("never caught up: %+v", st)
	}
	if st.Depth > st.Target+overBy+1 {
		t.Fatalf("still %d deep against a target of %d: %+v", st.Depth, st.Target, st)
	}
}

func TestLostPacketIsRebuiltFromFEC(t *testing.T) {
	s, r := newSender(t), newRig(t)
	for i := 0; i < 200; i++ {
		pkt := s.packet(false)
		if i == 100 {
			continue // lost
		}
		r.p.Push("a", pkt)
		r.tick()
		r.tick()
	}
	st := r.p.Stats("a")
	if st.Recovered != 1 || st.Concealed != 0 {
		t.Fatalf("one loss with FEC available: %+v", st)
	}
}

func TestLossWithoutTheNextPacketIsConcealed(t *testing.T) {
	s, r := newSender(t), newRig(t)
	for i := 0; i < 200; i++ {
		pkt := s.packet(false)
		if i == 100 || i == 101 {
			continue // two in a row: the first has no FEC to lean on
		}
		r.p.Push("a", pkt)
		r.tick()
		r.tick()
	}
	st := r.p.Stats("a")
	if st.Concealed+st.Recovered != 2 || st.Concealed == 0 {
		t.Fatalf("two losses in a row: %+v", st)
	}
	if r.silent > 30 {
		t.Fatalf("a two-frame loss left %d silent pieces", r.silent)
	}
}

func TestReorderIsNotALoss(t *testing.T) {
	s, r := newSender(t), newRig(t)
	for i := 0; i < 200; i++ {
		a := s.packet(false)
		if i%40 == 20 {
			b := s.packet(false)
			r.p.Push("a", b) // the later one first
			r.p.Push("a", a)
			r.tick()
			r.tick()
			i++
		} else {
			r.p.Push("a", a)
		}
		r.tick()
		r.tick()
	}
	st := r.p.Stats("a")
	if st.Concealed != 0 || st.Recovered != 0 {
		t.Fatalf("reordering was treated as loss: %+v", st)
	}
}

func TestTalkspurtEndIsNotAnUnderrun(t *testing.T) {
	s, r := newSender(t), newRig(t)
	for i := 0; i < 100; i++ {
		r.p.Push("a", s.packet(false))
		r.tick()
		r.tick()
	}
	for i := 0; i < 100; i++ { // a second of the peer's gate being shut
		r.tick()
		r.tick()
	}
	st := r.p.Stats("a")
	if st.Underruns != 0 {
		t.Fatalf("the peer going quiet counted as an underrun: %+v", st)
	}
	for i := 0; i < 100; i++ {
		r.p.Push("a", s.packet(false))
		r.tick()
		r.tick()
	}
	st = r.p.Stats("a")
	if st.Concealed != 0 || st.Dropped != 0 || st.Underruns != 0 {
		t.Fatalf("the next talkspurt did not start clean: %+v", st)
	}
}
