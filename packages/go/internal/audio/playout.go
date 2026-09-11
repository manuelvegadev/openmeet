package audio

import (
	"sync"
	"time"

	"github.com/pion/rtp"
	"gopkg.in/hraban/opus.v2"
)

// The playout side, which pion does not provide: per peer, an RTP jitter buffer, an Opus
// decoder with loss concealment, and a FIFO of decoded audio; across peers, a mixer feeding
// the playback device. libwebrtc's NetEq did all of this for the Node client. This is the
// smallest version that is correct, not the last word: it reorders, conceals single losses
// with Opus PLC, starts each talkspurt after a short prefill, deepens the prefill when it
// underruns, and drops a packet when the buffer runs away — which is what clock drift
// between two sound cards looks like from here.

const (
	// Packets held before a talkspurt starts playing: two is 40 ms, the usual floor.
	prefillMin = 2
	prefillMax = 6
	// Beyond target + this for a whole second, the buffer is running away and a packet is
	// dropped. The second is what tells drift from a burst.
	runawayPackets = 2
	runawayFor     = time.Second
	speakingHold   = 300 * time.Millisecond
)

type peer struct {
	dec     *opus.Decoder
	packets map[uint16]*rtp.Packet
	nextSeq uint16
	started bool
	target  int
	fifo    []int16 // decoded, interleaved stereo
	pcm     []int16
	// When the last packet arrived: tells a stalled network from a peer that stopped talking.
	lastArrival time.Time
	// Since when the buffer has been deeper than it should; zero while it is not.
	overSince time.Time
	volume    float64
	speaking  bool
	speakUtil time.Time
	Underruns int
	Dropped   int
	Concealed int
	Received  int
	lastTS    uint32
	tsDelta   uint32
}

type Playout struct {
	mu         sync.Mutex
	peers      map[string]*peer
	onSpeaking func(id string, on bool)
	events     []speakEvent
	mix        []int32
}

type speakEvent struct {
	id string
	on bool
}

func NewPlayout(onSpeaking func(id string, on bool)) *Playout {
	return &Playout{peers: map[string]*peer{}, onSpeaking: onSpeaking}
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
		target:  prefillMin,
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
	if pr.started && seqBefore(pkt.SequenceNumber, pr.nextSeq) {
		return // already played past it
	}
	// A new talkspurt after a long silence: the buffer is empty and the sequence continues,
	// so nothing special is needed — the prefill applies again because started is reset on
	// underrun.
	pr.packets[pkt.SequenceNumber] = pkt
	pr.lastArrival = time.Now()
	pr.Received++
	if pr.lastTS != 0 {
		pr.tsDelta = pkt.Timestamp - pr.lastTS
	}
	pr.lastTS = pkt.Timestamp
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

// pull decodes the next 20 ms into pr.pcm (stereo) and returns whether it was real audio.
func (pr *peer) pull(now time.Time) bool {
	if !pr.started {
		if len(pr.packets) < pr.target {
			return false
		}
		pr.nextSeq, _ = pr.minSeq()
		pr.started = true
	}
	// Deeper than the target by a margin, and not a burst: the sender's clock is ahead of
	// ours, or a burst at the start left us behind. Skip a packet to catch up — 20 ms lost
	// once, against 20 ms of extra latency for the rest of the call.
	if len(pr.packets) > pr.target+runawayPackets {
		if pr.overSince.IsZero() {
			pr.overSince = now
		} else if now.Sub(pr.overSince) > runawayFor {
			if _, ok := pr.packets[pr.nextSeq]; ok {
				delete(pr.packets, pr.nextSeq)
				pr.nextSeq++
				pr.Dropped++
			}
		}
	} else {
		pr.overSince = time.Time{}
	}
	pkt := pr.packets[pr.nextSeq]
	if pkt != nil {
		delete(pr.packets, pr.nextSeq)
		pr.nextSeq++
		n, err := pr.dec.Decode(pkt.Payload, pr.pcm)
		if err != nil || n == 0 {
			return false
		}
		return true
	}
	if len(pr.packets) == 0 {
		// Nothing later either. Either the peer stopped talking — their gate shut, packets
		// simply stopped — or the network stalled mid-word. Only the second is an underrun
		// worth a deeper prefill: the first is what most of a call looks like.
		pr.started = false
		if now.Sub(pr.lastArrival) < 100*time.Millisecond {
			pr.Underruns++
			if pr.target < prefillMax {
				pr.target++
			}
		}
		return false
	}
	// Later packets are here and this one is not: a loss. Conceal it.
	pr.nextSeq++
	pr.Concealed++
	if err := pr.dec.DecodePLC(pr.pcm); err != nil {
		return false
	}
	return true
}

// Fill mixes every peer into out (interleaved stereo). Runs on the playback thread.
func (p *Playout) Fill(out []int16) {
	p.mu.Lock()
	if cap(p.mix) < len(out) {
		p.mix = make([]int32, len(out))
	}
	mix := p.mix[:len(out)]
	for i := range mix {
		mix[i] = 0
	}
	now := time.Now()
	for id, pr := range p.peers {
		for len(pr.fifo) < len(out) {
			if pr.pull(now) {
				pr.fifo = append(pr.fifo, pr.pcm...)
				p.observe(id, pr, now)
			} else {
				// Silence for one frame; keeps the FIFO honest about time.
				pr.fifo = append(pr.fifo, make([]int16, FrameLen*OutChannels)...)
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

// Stats is a peer's playout counters, for the debug line.
func (p *Playout) Stats(id string) (underruns, dropped, concealed, depth, received int, tsDelta uint32) {
	p.mu.Lock()
	defer p.mu.Unlock()
	pr := p.peers[id]
	if pr == nil {
		return
	}
	return pr.Underruns, pr.Dropped, pr.Concealed, len(pr.packets), pr.Received, pr.tsDelta
}
