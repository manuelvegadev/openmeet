package audio

import (
	"math"
	"sync"
	"time"

	"github.com/pion/rtp"
	"gopkg.in/hraban/opus.v2"
)

// The playout side, which pion does not provide and libwebrtc's NetEq did for the Node
// client: per peer, an RTP jitter buffer, an Opus decoder, and a FIFO of decoded audio;
// across peers, a mixer feeding the playback ring.
//
// What it does, in the order it matters:
//
//   - Reorders, and holds a few packets before a talkspurt starts playing. How many is
//     measured: the RFC 3550 interarrival jitter, kept per peer, sets the target between
//     two packets (40 ms) and six.
//   - A lost packet is rebuilt from the in-band FEC of the one after it when that has
//     arrived, and concealed by Opus's PLC otherwise. An underrun mid-talkspurt is
//     concealed for a few frames too, so a late packet is a smear and not a hole.
//   - When the buffer is deeper than it should be — a burst at the start of a connection,
//     a sender whose clock runs ahead of ours — it catches up by skipping frames that are
//     nearly silent, which nobody hears. Only if none comes along for a while does it skip
//     a loud one.
//
// Every peer's clock is its own; with senders that gate their silence, each talkspurt
// starts the buffer afresh, so drift only ever has one sentence to accumulate in.

const (
	targetMin = 2
	targetMax = 6
	// Over target by this, for this long, is drift rather than a burst.
	overBy  = 1
	overFor = 500 * time.Millisecond
	// A frame under this RMS may be skipped to catch up without anyone noticing.
	quietRMS = 200.0
	// Failing a quiet frame for this long, a loud one goes: better one click than a
	// second of latency for the rest of the call.
	loudSkipAfter = 3 * time.Second
	// Frames concealed at an underrun before giving up and waiting for a fresh prefill.
	underrunConceal = 3
	speakingHold    = 300 * time.Millisecond
)

type peer struct {
	dec     *opus.Decoder
	packets map[uint16]*rtp.Packet
	nextSeq uint16
	started bool
	target  int
	fifo    []int16 // decoded, interleaved stereo
	pcm     []int16
	volume  float64

	// Jitter, RFC 3550 style, in milliseconds; and what it needs.
	jitter       float64
	prevTransit  float64
	haveTransit  bool
	lastArrival  time.Time
	overSince    time.Time
	concealedRun int
	// When the buffer ran dry mid-stream, if it did: an underrun is only counted once a
	// packet turns up soon after, because at the moment it runs dry a stalled network and
	// a peer who just stopped talking look exactly the same.
	stalledAt time.Time

	speaking  bool
	speakUtil time.Time

	Received  int
	Underruns int
	Skipped   int // quiet frames dropped to catch up
	Dropped   int // loud frames dropped to catch up
	Recovered int // rebuilt from FEC
	Concealed int // PLC
}

type Playout struct {
	mu         sync.Mutex
	peers      map[string]*peer
	onSpeaking func(id string, on bool)
	events     []speakEvent
	mix        []int32
	now        func() time.Time
}

type speakEvent struct {
	id string
	on bool
}

func NewPlayout(onSpeaking func(id string, on bool)) *Playout {
	return &Playout{peers: map[string]*peer{}, onSpeaking: onSpeaking, now: time.Now}
}

func (p *Playout) AddPeer(id string) error {
	dec, err := opus.NewDecoder(SampleRate, OutChannels)
	if err != nil {
		return err
	}
	p.mu.Lock()
	p.peers[id] = &peer{
		dec:     dec,
		packets: map[uint16]*rtp.Packet{},
		target:  targetMin,
		pcm:     make([]int16, FrameLen*OutChannels),
		volume:  1,
	}
	p.mu.Unlock()
	return nil
}

func (p *Playout) RemovePeer(id string) {
	p.mu.Lock()
	delete(p.peers, id)
	p.mu.Unlock()
}

func (p *Playout) SetVolume(id string, v float64) {
	p.mu.Lock()
	if pr := p.peers[id]; pr != nil {
		pr.volume = v
	}
	p.mu.Unlock()
}

// Push takes a packet from a peer's audio track, in whatever order the network chose.
func (p *Playout) Push(id string, pkt *rtp.Packet) {
	p.mu.Lock()
	defer p.mu.Unlock()
	pr := p.peers[id]
	if pr == nil {
		return
	}
	now := p.now()
	pr.Received++
	pr.lastArrival = now
	if !pr.stalledAt.IsZero() {
		if now.Sub(pr.stalledAt) < 200*time.Millisecond {
			pr.Underruns++
		}
		pr.stalledAt = time.Time{}
	}
	// Interarrival jitter: how much the packet's lateness, relative to its own timestamp,
	// moved since the last one. Smoothed 1/16, as the RFC has it.
	transit := float64(now.UnixMicro())/1000 - float64(pkt.Timestamp)/(SampleRate/1000)
	if pr.haveTransit {
		d := math.Abs(transit - pr.prevTransit)
		pr.jitter += (d - pr.jitter) / 16
	}
	pr.prevTransit, pr.haveTransit = transit, true
	if pr.started && seqBefore(pkt.SequenceNumber, pr.nextSeq) {
		return // already played past it
	}
	pr.packets[pkt.SequenceNumber] = pkt
}

func seqBefore(a, b uint16) bool { return int16(a-b) < 0 }

func (pr *peer) minSeq() (uint16, bool) {
	var best uint16
	found := false
	for s := range pr.packets {
		if !found || seqBefore(s, best) {
			best, found = s, true
		}
	}
	return best, found
}

// wantedDepth is the prefill the measured jitter asks for: a packet per 20 ms of jitter,
// on top of the two that are always held.
func (pr *peer) wantedDepth() int {
	t := targetMin + int(math.Ceil(pr.jitter/FrameMs))
	if t > targetMax {
		return targetMax
	}
	return t
}

// pull decodes the next 20 ms into pr.pcm and returns whether there is audio to play.
func (pr *peer) pull(now time.Time) bool {
	pr.target = pr.wantedDepth()
	if !pr.started {
		if len(pr.packets) < pr.target {
			return false
		}
		pr.nextSeq, _ = pr.minSeq()
		pr.started = true
		pr.concealedRun = 0
	}

	// Catching up: deeper than the target for a while means the sender is ahead of us.
	if len(pr.packets) > pr.target+overBy {
		if pr.overSince.IsZero() {
			pr.overSince = now
		}
	} else {
		pr.overSince = time.Time{}
	}
	over := !pr.overSince.IsZero() && now.Sub(pr.overSince) > overFor

	pkt := pr.packets[pr.nextSeq]
	switch {
	case pkt != nil:
		delete(pr.packets, pr.nextSeq)
		pr.nextSeq++
		if n, err := pr.dec.Decode(pkt.Payload, pr.pcm); err != nil || n == 0 {
			return false
		}
		pr.concealedRun = 0
		if over {
			if RMS(pr.pcm) < quietRMS {
				pr.Skipped++
				return pr.pull(now) // this one nobody would have heard; play the next
			}
			if now.Sub(pr.overSince) > loudSkipAfter {
				pr.Dropped++
				pr.overSince = now
				return pr.pull(now)
			}
		}
		return true
	case pr.packets[pr.nextSeq+1] != nil:
		// The one after it is here: its in-band FEC carries this frame at a lower rate,
		// which beats guessing.
		next := pr.packets[pr.nextSeq+1]
		pr.nextSeq++
		pr.Recovered++
		return pr.dec.DecodeFEC(next.Payload, pr.pcm) == nil
	case len(pr.packets) > 0:
		// Later packets are here and this one is not: a loss. Conceal it.
		pr.nextSeq++
		pr.Concealed++
		return pr.dec.DecodePLC(pr.pcm) == nil
	default:
		// Nothing later either. Either the peer stopped talking — their gate shut, the
		// packets simply stopped — or the network is late mid-word. Only the second is an
		// underrun: conceal a few frames of it, then wait for a fresh prefill.
		if now.Sub(pr.lastArrival) < 100*time.Millisecond && pr.concealedRun < underrunConceal {
			if pr.concealedRun == 0 {
				pr.stalledAt = now
			}
			pr.concealedRun++
			pr.nextSeq++
			return pr.dec.DecodePLC(pr.pcm) == nil
		}
		pr.started = false
		return false
	}
}

// Fill mixes every peer into out (interleaved stereo). Runs on the pump goroutine.
func (p *Playout) Fill(out []int16) {
	p.mu.Lock()
	if cap(p.mix) < len(out) {
		p.mix = make([]int32, len(out))
	}
	mix := p.mix[:len(out)]
	for i := range mix {
		mix[i] = 0
	}
	now := p.now()
	for id, pr := range p.peers {
		for len(pr.fifo) < len(out) {
			if pr.pull(now) {
				pr.fifo = append(pr.fifo, pr.pcm...)
				p.observe(id, pr, now)
			} else {
				pr.fifo = append(pr.fifo, silence[:FrameLen*OutChannels]...)
			}
		}
		if pr.volume == 1 {
			for i := range out {
				mix[i] += int32(pr.fifo[i])
			}
		} else {
			for i := range out {
				mix[i] += int32(float64(pr.fifo[i]) * pr.volume)
			}
		}
		pr.fifo = append(pr.fifo[:0], pr.fifo[len(out):]...)
		if pr.speaking && now.After(pr.speakUtil) {
			pr.speaking = false
			p.events = append(p.events, speakEvent{id, false})
		}
	}
	for i, v := range mix {
		if v > 32767 {
			v = 32767
		} else if v < -32768 {
			v = -32768
		}
		out[i] = int16(v)
	}
	events := p.events
	p.events = nil
	p.mu.Unlock()
	for _, e := range events {
		if p.onSpeaking != nil {
			p.onSpeaking(e.id, e.on)
		}
	}
}

var silence = make([]int16, FrameLen*OutChannels)

// observe updates the peer's speaking state from a decoded frame. Called under the lock.
func (p *Playout) observe(id string, pr *peer, now time.Time) {
	if RMS(pr.pcm) > SpeakingRMSThreshold {
		pr.speakUtil = now.Add(speakingHold)
		if !pr.speaking {
			pr.speaking = true
			p.events = append(p.events, speakEvent{id, true})
		}
	}
}

// PeerStats is a peer's playout counters, for the stats line and the tests.
type PeerStats struct {
	Received, Underruns, Skipped, Dropped, Recovered, Concealed, Depth, Target int
	JitterMs                                                                   float64
}

func (p *Playout) Stats(id string) PeerStats {
	p.mu.Lock()
	defer p.mu.Unlock()
	pr := p.peers[id]
	if pr == nil {
		return PeerStats{}
	}
	return PeerStats{
		Received: pr.Received, Underruns: pr.Underruns, Skipped: pr.Skipped, Dropped: pr.Dropped,
		Recovered: pr.Recovered, Concealed: pr.Concealed, Depth: len(pr.packets), Target: pr.target,
		JitterMs: pr.jitter,
	}
}
