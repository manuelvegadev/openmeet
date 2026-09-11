// Package signal speaks the server's WebSocket protocol — the same JSON the Node client
// sends, so a Go client and a Node client can share a room while the migration runs.
// The shapes mirror packages/shared/src/types.ts; keep them in step by hand.
package signal

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/coder/websocket"
)

type Participant struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	JoinedAt string `json:"joinedAt"`
	Color    string `json:"color,omitempty"`
}

// SessionDescription is RTCSessionDescriptionInit on the wire.
type SessionDescription struct {
	Type string `json:"type"`
	SDP  string `json:"sdp"`
}

// ICECandidate is RTCIceCandidateInit on the wire.
type ICECandidate struct {
	Candidate        string  `json:"candidate"`
	SDPMid           *string `json:"sdpMid,omitempty"`
	SDPMLineIndex    *uint16 `json:"sdpMLineIndex,omitempty"`
	UsernameFragment *string `json:"usernameFragment,omitempty"`
}

type ChatMessage struct {
	ID        string `json:"id"`
	RoomID    string `json:"roomId"`
	Username  string `json:"username"`
	Color     string `json:"color,omitempty"`
	Content   string `json:"content"`
	Timestamp int64  `json:"timestamp"`
}

// Message is the discriminated union, flattened: every field of every message type, with
// `Type` saying which apply. Decoding into one struct is simpler than a tagged decode and
// the protocol is small enough for it.
type Message struct {
	Type string `json:"type"`

	// join-room, room-joined, chat-message
	RoomID   string `json:"roomId,omitempty"`
	Username string `json:"username,omitempty"`
	Color    string `json:"color,omitempty"`

	// room-joined
	YourID       string        `json:"yourId,omitempty"`
	Participants []Participant `json:"participants,omitempty"`

	// participant-joined / participant-left
	Participant   *Participant `json:"participant,omitempty"`
	ParticipantID string       `json:"participantId,omitempty"`

	// offer / answer / ice-candidate / mute-state / screen-share-state
	FromID    string              `json:"fromId,omitempty"`
	ToID      string              `json:"toId,omitempty"`
	SDP       *SessionDescription `json:"sdp,omitempty"`
	Candidate *ICECandidate       `json:"candidate,omitempty"`

	// mute-state
	IsAudioMuted *bool `json:"isAudioMuted,omitempty"`
	IsVideoMuted *bool `json:"isVideoMuted,omitempty"`
	// screen-share-state
	IsScreenSharing *bool `json:"isScreenSharing,omitempty"`

	// chat-message (sent) carries these at the top level
	ID        string `json:"id,omitempty"`
	Content   string `json:"content,omitempty"`
	Timestamp int64  `json:"timestamp,omitempty"`
	// chat-broadcast (received)
	ChatMessage *ChatMessage `json:"message,omitempty"`

	// error
	ErrorMessage string `json:"-"`
}

// errorMessage is what `error` looks like: its `message` is a string, where chat-broadcast's
// is an object, so it gets its own decode.
type errorMessage struct {
	Message string `json:"message"`
}

// Client is one connection to the signaling server. Messages arrive on Incoming in order;
// Send may be called from any goroutine.
type Client struct {
	url      string
	conn     *websocket.Conn
	sendMu   sync.Mutex
	Incoming chan Message
	Closed   chan error
}

func Dial(ctx context.Context, url string) (*Client, error) {
	conn, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		return nil, fmt.Errorf("signaling: %w", err)
	}
	// Signaling is small, but a room-joined with six participants and colours is not tiny.
	conn.SetReadLimit(1 << 20)
	c := &Client{url: url, conn: conn, Incoming: make(chan Message, 64), Closed: make(chan error, 1)}
	go c.readLoop()
	return c, nil
}

func (c *Client) readLoop() {
	defer close(c.Incoming)
	for {
		_, data, err := c.conn.Read(context.Background())
		if err != nil {
			c.Closed <- err
			return
		}
		var msg Message
		if err := json.Unmarshal(data, &msg); err != nil {
			// An `error` message fails the union decode on its string `message`; read it alone.
			var e struct {
				Type string `json:"type"`
				errorMessage
			}
			if json.Unmarshal(data, &e) == nil && e.Type == "error" {
				c.Incoming <- Message{Type: "error", ErrorMessage: e.Message}
			}
			continue
		}
		c.Incoming <- msg
	}
}

func (c *Client) Send(msg Message) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	c.sendMu.Lock()
	defer c.sendMu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return c.conn.Write(ctx, websocket.MessageText, data)
}

func (c *Client) Close() {
	_ = c.conn.Close(websocket.StatusNormalClosure, "bye")
}
