// Package rtc is the mesh: one pion PeerConnection per peer, speaking the contract the Node
// client speaks (three transceivers in a fixed order — audio, webcam, screen — and perfect
// negotiation with `polite = myID < peerID`), and one audio track bound to all of them.
//
// That last part is the reason this client exists. TrackLocalStaticRTP.WriteRTP writes the
// same packet to every bound PeerConnection, adjusting SSRC and payload type per binding, so
// the microphone is encoded once whatever the room size. The Node client could not do this:
// its binding takes PCM per connection and builds an encoder for each.
package rtc

import (
	"fmt"
	"github.com/pion/rtp/codecs"
	"math"
	"math/rand/v2"
	"strings"
	"sync"
	"time"

	"github.com/pion/interceptor"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"

	"github.com/pion/webrtc/v4/pkg/media"

	"github.com/manuelvegadev/openmeet/packages/go/internal/audio"
	"github.com/manuelvegadev/openmeet/packages/go/internal/signal"
)

var iceServers = []webrtc.ICEServer{
	{URLs: []string{"stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"}},
}

const maxRetries = 3

// LeanInterceptors drops NACK and TWCC from the pion pipeline: an experiment knob for the
// per-packet-cost question. Audio with in-band FEC has little use for either.
var LeanInterceptors = false

type conn struct {
	pc          *webrtc.PeerConnection
	makingOffer bool
	pending     []webrtc.ICECandidateInit
	retries     int
}

type Manager struct {
	myID    string
	api     *webrtc.API
	track   *webrtc.TrackLocalStaticRTP
	webcam  *videoTrack
	screen  *videoTrack
	send    func(signal.Message) error
	onAudio func(peerID string, pkt *rtp.Packet)
	onVideo func(peerID string, kind string, track *webrtc.TrackRemote)
	onState func(peerID string, state string)
	log     func(format string, args ...any)

	mu    sync.Mutex
	conns map[string]*conn
	seq   uint16
	ssrc  uint32
}

type Options struct {
	MyID    string
	Send    func(signal.Message) error
	OnAudio func(peerID string, pkt *rtp.Packet)
	// A peer's video track, "webcam" or "screen" by the contract's transceiver order.
	OnVideo func(peerID string, kind string, track *webrtc.TrackRemote)
	OnState func(peerID string, state string)
	Log     func(format string, args ...any)
}

func NewManager(o Options) (*Manager, error) {
	me := &webrtc.MediaEngine{}
	// Opus only for audio. The Node client offers RED ahead of Opus; an answer without RED
	// makes it send bare Opus, which is what a single decoder per peer wants.
	if err := me.RegisterCodec(webrtc.RTPCodecParameters{
		RTPCodecCapability: webrtc.RTPCodecCapability{
			MimeType: webrtc.MimeTypeOpus, ClockRate: 48000, Channels: 2,
			SDPFmtpLine: "minptime=10;useinbandfec=1",
		},
		PayloadType: 111,
	}, webrtc.RTPCodecTypeAudio); err != nil {
		return nil, err
	}
	// Video is H.264, because that is what the machine's hardware encoder makes and pion
	// carries any codec it is handed — the door the retired client's
	// binding kept shut. Constrained baseline, packetization mode 1, as browsers offer it.
	//
	// The feedback list is what makes pion's NACK interceptors act on this stream: a lost
	// video packet is retransmitted instead of breaking the frame and everything after it
	// until the next keyframe. Audio carries no such list on purpose — a retransmitted 20 ms
	// frame arrives too late to play, and FEC already covers it — so the responder keeps no
	// history for it. PLI and FIR are accepted (a keyframe comes every second regardless;
	// ffmpeg cannot be asked for one mid-stream), REMB is offered for a browser someday.
	if err := me.RegisterCodec(webrtc.RTPCodecParameters{
		RTPCodecCapability: webrtc.RTPCodecCapability{
			MimeType: webrtc.MimeTypeH264, ClockRate: 90000,
			SDPFmtpLine:  "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
			RTCPFeedback: []webrtc.RTCPFeedback{{Type: "nack"}, {Type: "nack", Parameter: "pli"}, {Type: "ccm", Parameter: "fir"}, {Type: "goog-remb"}},
		},
		PayloadType: 102,
	}, webrtc.RTPCodecTypeVideo); err != nil {
		return nil, err
	}
	reg := &interceptor.Registry{}
	if LeanInterceptors {
		if err := webrtc.ConfigureRTCPReports(reg); err != nil {
			return nil, err
		}
	} else if err := webrtc.RegisterDefaultInterceptors(me, reg); err != nil {
		return nil, err
	}
	track, err := webrtc.NewTrackLocalStaticRTP(
		webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus, ClockRate: 48000, Channels: 2},
		"audio", "openmeet",
	)
	if err != nil {
		return nil, err
	}
	// The two video tracks, bound to every connection like the audio one: a share is
	// encoded once and its access units packetized once, whoever is in the room. Frames flow
	// only while a share runs; an idle track costs nothing.
	webcam, err := newVideoTrack("webcam")
	if err != nil {
		return nil, err
	}
	screen, err := newVideoTrack("screen")
	if err != nil {
		return nil, err
	}
	if o.Log == nil {
		o.Log = func(string, ...any) {}
	}
	se := webrtc.SettingEngine{}
	if n, err := newQOSNet(); err == nil {
		se.SetNet(n)
	}
	return &Manager{
		myID:    o.MyID,
		api:     webrtc.NewAPI(webrtc.WithMediaEngine(me), webrtc.WithInterceptorRegistry(reg), webrtc.WithSettingEngine(se)),
		track:   track,
		webcam:  webcam,
		screen:  screen,
		onVideo: o.OnVideo,
		send:    o.Send,
		onAudio: o.OnAudio,
		onState: o.OnState,
		log:     o.Log,
		conns:   map[string]*conn{},
		ssrc:    0x4f4d4554, // "OMET"; rewritten per binding anyway
	}, nil
}

func (m *Manager) SetMyID(id string) { m.myID = id }

// SetSend points signaling at a new connection, after a reconnect.
func (m *Manager) SetSend(send func(signal.Message) error) {
	m.mu.Lock()
	m.send = send
	m.mu.Unlock()
}

// Write sends one encoded frame to every connected peer. The sequence number is ours and
// runs across talkspurts; the timestamp is the capture clock.
func (m *Manager) Write(p audio.Packet) error {
	m.mu.Lock()
	m.seq++
	seq := m.seq
	m.mu.Unlock()
	return m.track.WriteRTP(&rtp.Packet{
		Header: rtp.Header{
			Version: 2, Marker: p.Marker, SequenceNumber: seq, Timestamp: p.Timestamp, SSRC: m.ssrc,
		},
		Payload: p.Payload,
	})
}

func (m *Manager) polite(peerID string) bool { return m.myID < peerID }

func (m *Manager) newPeerConnection(peerID string) (*conn, error) {
	pc, err := m.api.NewPeerConnection(webrtc.Configuration{ICEServers: iceServers})
	if err != nil {
		return nil, err
	}
	c := &conn{pc: pc}
	pc.OnICECandidate(func(cand *webrtc.ICECandidate) {
		if cand == nil {
			return
		}
		j := cand.ToJSON()
		_ = m.send(signal.Message{
			Type: "ice-candidate", FromID: m.myID, ToID: peerID,
			Candidate: &signal.ICECandidate{
				Candidate: j.Candidate, SDPMid: j.SDPMid, SDPMLineIndex: j.SDPMLineIndex,
				UsernameFragment: j.UsernameFragment,
			},
		})
	})
	pc.OnTrack(func(track *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		if track.Kind() == webrtc.RTPCodecTypeVideo {
			// The contract: transceiver 1 is the camera, 2 the screen — mids "1" and "2".
			kind := "webcam"
			for _, t := range pc.GetTransceivers() {
				if t.Receiver() == receiver && t.Mid() == "2" {
					kind = "screen"
				}
			}
			m.log("%s track from %s (%s)", kind, short(peerID), track.Codec().MimeType)
			if m.onVideo != nil {
				m.onVideo(peerID, kind, track)
			}
			return
		}
		m.log("audio track from %s (%s)", short(peerID), track.Codec().MimeType)
		for {
			pkt, _, err := track.ReadRTP()
			if err != nil {
				return
			}
			m.onAudio(peerID, pkt)
		}
	})
	pc.OnConnectionStateChange(func(s webrtc.PeerConnectionState) {
		m.log("%s: %s", short(peerID), s)
		if m.onState != nil {
			m.onState(peerID, s.String())
		}
		if s == webrtc.PeerConnectionStateFailed {
			m.mu.Lock()
			cur := m.conns[peerID]
			if cur == c {
				delete(m.conns, peerID)
			}
			retries := c.retries
			m.mu.Unlock()
			_ = pc.Close()
			// Only the impolite side retries, so the two do not collide.
			if cur == c && !m.polite(peerID) && retries < maxRetries {
				delay := time.Duration(1<<retries) * time.Second
				time.AfterFunc(delay, func() { m.offer(peerID, retries+1) })
			}
		}
	})
	return c, nil
}

// addTracks creates the three transceivers of the contract — audio, webcam, screen — each
// sendrecv and carrying the shared track, so a share needs no renegotiation to start: its
// frames simply begin, and the screen-share-state message says so.
func (m *Manager) addTracks(pc *webrtc.PeerConnection) error {
	init := webrtc.RTPTransceiverInit{Direction: webrtc.RTPTransceiverDirectionSendrecv}
	for _, t := range []webrtc.TrackLocal{m.track, m.webcam, m.screen} {
		if _, err := pc.AddTransceiverFromTrack(t, init); err != nil {
			return err
		}
	}
	return nil
}

// WriteVideo hands one encoded access unit to every peer, on the camera or the screen track.
func (m *Manager) WriteVideo(kind string, sample media.Sample) error {
	if kind == "screen" {
		return m.screen.write(sample)
	}
	return m.webcam.write(sample)
}

// videoTrack is an H.264 track written packet by packet, paced. A keyframe of a 1080p
// screen is 100–300 KB — 100 to 250 packets — and TrackLocalStaticSample writes them all
// in one tight loop, a burst that a Wi-Fi link or a small socket buffer drops the tail
// of; and since keyframes are the biggest frames, they were the ones most likely lost,
// which left the receiver decoding P-frames against a picture it never got until the next
// keyframe survived whole. Spreading the packets by a millisecond every pacingBurst keeps
// a frame under a few milliseconds and the bursts inside what the path can absorb.
type videoTrack struct {
	*webrtc.TrackLocalStaticRTP
	mu sync.Mutex
	pk rtp.Packetizer
	// A frame is rarely a whole number of 90 kHz ticks — 30 fps is 2999.99997 — so the
	// leftover is carried to the next one rather than truncated away every frame.
	remainder float64
}

const (
	videoMTU    = 1200
	pacingBurst = 16
	pacingGap   = time.Millisecond
)

func newVideoTrack(id string) (*videoTrack, error) {
	t, err := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeH264, ClockRate: 90000}, id, "openmeet")
	if err != nil {
		return nil, err
	}
	// The payload type and SSRC here are placeholders: WriteRTP rewrites both per binding.
	pk := rtp.NewPacketizer(videoMTU, 102, rand.Uint32(), &codecs.H264Payloader{}, rtp.NewRandomSequencer(), 90000)
	return &videoTrack{TrackLocalStaticRTP: t, pk: pk}, nil
}

func (v *videoTrack) write(s media.Sample) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	ticks := s.Duration.Seconds()*90000 + v.remainder
	whole := math.Floor(ticks)
	v.remainder = ticks - whole
	pkts := v.pk.Packetize(s.Data, uint32(whole))
	for i, p := range pkts {
		if i > 0 && i%pacingBurst == 0 {
			time.Sleep(pacingGap)
		}
		if err := v.WriteRTP(p); err != nil {
			return err
		}
	}
	return nil
}

// Offer starts a connection to a peer who was already in the room: we are the newcomer, so
// we create the three transceivers in the contract's order and send the offer.
func (m *Manager) Offer(peerID string) { m.offer(peerID, 0) }

func (m *Manager) offer(peerID string, retries int) {
	m.mu.Lock()
	if old := m.conns[peerID]; old != nil {
		_ = old.pc.Close()
	}
	c, err := m.newPeerConnection(peerID)
	if err != nil {
		m.mu.Unlock()
		m.log("peer connection for %s: %v", short(peerID), err)
		return
	}
	c.retries = retries
	c.makingOffer = true
	m.conns[peerID] = c
	m.mu.Unlock()

	pc := c.pc
	if err := m.addTracks(pc); err != nil {
		m.log("transceivers for %s: %v", short(peerID), err)
		return
	}
	offer, err := pc.CreateOffer(nil)
	if err == nil {
		err = pc.SetLocalDescription(offer)
	}
	m.mu.Lock()
	c.makingOffer = false
	m.mu.Unlock()
	if err != nil {
		m.log("offer to %s: %v", short(peerID), err)
		return
	}
	_ = m.send(signal.Message{
		Type: "offer", FromID: m.myID, ToID: peerID,
		SDP: &signal.SessionDescription{Type: "offer", SDP: offer.SDP},
	})
}

// HandleOffer answers a peer's offer, yielding or ignoring on glare by the contract's rule.
func (m *Manager) HandleOffer(peerID string, sdp *signal.SessionDescription) {
	m.mu.Lock()
	c := m.conns[peerID]
	collision := c != nil && (c.makingOffer || c.pc.SignalingState() != webrtc.SignalingStateStable)
	if collision && !m.polite(peerID) {
		m.mu.Unlock()
		m.log("glare with %s: impolite, ignoring their offer", short(peerID))
		return
	}
	if c != nil && (collision || c.pc.ConnectionState() == webrtc.PeerConnectionStateFailed) {
		m.log("glare with %s: polite, yielding", short(peerID))
		_ = c.pc.Close()
		delete(m.conns, peerID)
		c = nil
	}
	if c == nil {
		var err error
		c, err = m.newPeerConnection(peerID)
		if err != nil {
			m.mu.Unlock()
			m.log("peer connection for %s: %v", short(peerID), err)
			return
		}
		m.conns[peerID] = c
		// The three transceivers, in the contract's order, before the remote description:
		// pion matches them to the offer's m-lines by kind, in order.
		if err := m.addTracks(c.pc); err != nil {
			m.mu.Unlock()
			m.log("transceivers for %s: %v", short(peerID), err)
			return
		}
	}
	m.mu.Unlock()

	pc := c.pc
	if err := pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: sdp.SDP}); err != nil {
		m.log("offer from %s: %v", short(peerID), err)
		return
	}
	m.flushCandidates(c)
	answer, err := pc.CreateAnswer(nil)
	if err == nil {
		err = pc.SetLocalDescription(answer)
	}
	if err != nil {
		m.log("answer to %s: %v", short(peerID), err)
		return
	}
	_ = m.send(signal.Message{
		Type: "answer", FromID: m.myID, ToID: peerID,
		SDP: &signal.SessionDescription{Type: "answer", SDP: pc.LocalDescription().SDP},
	})
}

func (m *Manager) HandleAnswer(peerID string, sdp *signal.SessionDescription) {
	m.mu.Lock()
	c := m.conns[peerID]
	m.mu.Unlock()
	if c == nil {
		return
	}
	if err := c.pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: sdp.SDP}); err != nil {
		m.log("answer from %s: %v", short(peerID), err)
		return
	}
	m.flushCandidates(c)
}

func (m *Manager) HandleCandidate(peerID string, cand *signal.ICECandidate) {
	if cand == nil || cand.Candidate == "" {
		return
	}
	init := webrtc.ICECandidateInit{
		Candidate: cand.Candidate, SDPMid: cand.SDPMid, SDPMLineIndex: cand.SDPMLineIndex,
		UsernameFragment: cand.UsernameFragment,
	}
	m.mu.Lock()
	c := m.conns[peerID]
	if c == nil {
		m.mu.Unlock()
		return
	}
	if c.pc.RemoteDescription() == nil {
		c.pending = append(c.pending, init)
		m.mu.Unlock()
		return
	}
	m.mu.Unlock()
	if err := c.pc.AddICECandidate(init); err != nil {
		m.log("candidate from %s: %v", short(peerID), err)
	}
}

func (m *Manager) flushCandidates(c *conn) {
	m.mu.Lock()
	pending := c.pending
	c.pending = nil
	m.mu.Unlock()
	for _, init := range pending {
		_ = c.pc.AddICECandidate(init)
	}
}

func (m *Manager) Remove(peerID string) {
	m.mu.Lock()
	c := m.conns[peerID]
	delete(m.conns, peerID)
	m.mu.Unlock()
	if c != nil {
		_ = c.pc.Close()
	}
}

func (m *Manager) CloseAll() {
	m.mu.Lock()
	conns := m.conns
	m.conns = map[string]*conn{}
	m.mu.Unlock()
	for _, c := range conns {
		_ = c.pc.Close()
	}
}

// RTTs is the current round-trip time per peer in milliseconds, from the ICE candidate pair
// in use — what the header's RTT and the per-peer latency estimate are built on.
func (m *Manager) RTTs() map[string]int {
	m.mu.Lock()
	conns := make(map[string]*conn, len(m.conns))
	for id, c := range m.conns {
		conns[id] = c
	}
	m.mu.Unlock()
	out := map[string]int{}
	for id, c := range conns {
		for _, st := range c.pc.GetStats() {
			if pair, ok := st.(webrtc.ICECandidatePairStats); ok && pair.State == webrtc.StatsICECandidatePairStateSucceeded && pair.Nominated {
				out[id] = int(pair.CurrentRoundTripTime*1000 + 0.5)
			}
		}
	}
	return out
}

// Stats returns a one-line summary per peer for the debug view.
func (m *Manager) Stats() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	parts := make([]string, 0, len(m.conns))
	for id, c := range m.conns {
		parts = append(parts, fmt.Sprintf("%s:%s", short(id), c.pc.ConnectionState()))
	}
	return strings.Join(parts, " ")
}

func short(id string) string {
	if len(id) > 6 {
		return id[:6]
	}
	return id
}
