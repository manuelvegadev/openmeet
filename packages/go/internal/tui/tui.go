// Package tui is the room on screen, kept deliberately small for the spike: who is here,
// whether they are on the air, the chat, and the three keys that matter. Bubble Tea repaints
// only the lines that changed, and nothing here changes unless a person did something.
package tui

import (
	"fmt"
	"sort"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// Events the engine sends into the model. One type per fact, so the model never guesses.
type (
	Participants struct {
		Me   Person
		List []Person
	}
	Speaking struct {
		ID string
		On bool
	}
	Muted struct {
		ID string
		On bool
	}
	Chat struct {
		Who, Color, Text string
		At               time.Time
	}
	Notice   string
	State    struct{ ID, State string }
	Stats    string
	MyMuted  bool
	Finished struct{}
)

type Person struct {
	ID, Name, Color string
}

// Actions the person takes; the engine handles them.
type Actions struct {
	ToggleMute func()
	SendChat   func(text string)
	Quit       func()
}

var (
	accent = lipgloss.NewStyle().Foreground(lipgloss.Color("#E8B900"))
	muted  = lipgloss.NewStyle().Foreground(lipgloss.Color("#8A8A8A"))
	ok     = lipgloss.NewStyle().Foreground(lipgloss.Color("#22C55E"))
	warn   = lipgloss.NewStyle().Foreground(lipgloss.Color("#F59E0B"))
)

type line struct {
	at   time.Time
	text string
}

type Model struct {
	room     string
	me       Person
	list     []Person
	speaking map[string]bool
	mutedBy  map[string]bool
	states   map[string]string
	myMuted  bool
	chat     []line
	input    string
	stats    string
	joinedAt time.Time
	actions  Actions
	width    int
	height   int
}

func New(room string, actions Actions) Model {
	return Model{
		room: room, actions: actions,
		speaking: map[string]bool{}, mutedBy: map[string]bool{}, states: map[string]string{},
		joinedAt: time.Now(), width: 80, height: 24,
	}
}

func (m Model) Init() tea.Cmd { return nil }

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
	case Participants:
		m.me, m.list = msg.Me, msg.List
		sort.Slice(m.list, func(i, j int) bool { return m.list[i].Name < m.list[j].Name })
	case Speaking:
		m.speaking[msg.ID] = msg.On
	case Muted:
		m.mutedBy[msg.ID] = msg.On
	case MyMuted:
		m.myMuted = bool(msg)
	case Chat:
		m.chat = append(m.chat, line{msg.At, fmt.Sprintf("%s %s",
			lipgloss.NewStyle().Foreground(lipgloss.Color(msg.Color)).Render("["+msg.Who+"]"), msg.Text)})
	case Notice:
		m.chat = append(m.chat, line{time.Now(), muted.Render("· " + string(msg))})
	case State:
		m.states[msg.ID] = msg.State
	case Stats:
		m.stats = string(msg)
	case Finished:
		return m, tea.Quit
	case tea.KeyMsg:
		switch msg.Type {
		case tea.KeyCtrlC:
			m.actions.Quit()
			return m, tea.Quit
		case tea.KeyEnter:
			if text := strings.TrimSpace(m.input); text != "" {
				m.actions.SendChat(text)
			}
			m.input = ""
		case tea.KeyBackspace:
			if len(m.input) > 0 {
				r := []rune(m.input)
				m.input = string(r[:len(r)-1])
			}
		case tea.KeyEsc:
			m.input = ""
		case tea.KeyRunes:
			s := msg.String()
			if m.input == "" {
				switch s {
				case "q":
					m.actions.Quit()
					return m, tea.Quit
				case "m":
					m.actions.ToggleMute()
					return m, nil
				}
			}
			m.input += s
		case tea.KeySpace:
			m.input += " "
		}
	}
	return m, nil
}

func (m Model) View() string {
	var b strings.Builder
	elapsed := time.Since(m.joinedAt).Round(time.Second)
	fmt.Fprintf(&b, "%s  %s  %s\n", accent.Bold(true).Render("OpenMeet (go)"),
		muted.Render(fmt.Sprintf("room %s · %dp · %s", m.room, len(m.list)+1, elapsed)), muted.Render(m.stats))
	b.WriteString(muted.Render(strings.Repeat("─", max(20, m.width-1))) + "\n")

	b.WriteString(m.row(m.me, m.speaking[m.me.ID] && !m.myMuted, m.myMuted, "") + "\n")
	for _, p := range m.list {
		st := ""
		if s := m.states[p.ID]; s != "" && s != "connected" {
			st = muted.Render(" " + s)
		}
		b.WriteString(m.row(p, m.speaking[p.ID] && !m.mutedBy[p.ID], m.mutedBy[p.ID], st) + "\n")
	}
	b.WriteString("\n")

	// The chat: as many of the last lines as fit above the input row.
	rows := max(3, m.height-len(m.list)-9)
	start := max(0, len(m.chat)-rows)
	for _, l := range m.chat[start:] {
		fmt.Fprintf(&b, "%s %s\n", muted.Render(l.at.Format("15:04")), l.text)
	}
	for i := len(m.chat[start:]); i < rows; i++ {
		b.WriteString("\n")
	}
	b.WriteString(muted.Render(strings.Repeat("─", max(20, m.width-1))) + "\n")
	fmt.Fprintf(&b, "> %s%s\n", m.input, accent.Render("▏"))
	b.WriteString(muted.Render("m mute · enter send · q quit"))
	return b.String()
}

func (m Model) row(p Person, speaking, isMuted bool, extra string) string {
	dot := muted.Render("○")
	if speaking {
		dot = ok.Render("●")
	}
	name := lipgloss.NewStyle().Foreground(lipgloss.Color(p.Color)).Render("[" + p.Name + "]")
	tag := ""
	if isMuted {
		tag = " " + warn.Render("m")
	}
	return fmt.Sprintf("%s %s%s%s", dot, name, tag, extra)
}
