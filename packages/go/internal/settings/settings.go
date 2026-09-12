// Package settings reads and writes the same settings.json the Node client keeps —
// ~/.config/openmeet on macOS and Linux, %APPDATA%\openmeet on Windows — field for field,
// so the two clients are the same person with the same devices.
package settings

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
)

// App is the file, which is still the Node client's field for field. Six of them —
// VideoOverlay, AudioInputChannels, AudioInputGainDb, AudioReceiveKbps, ScreenReceiveKbps,
// NoiseSuppression and PauseRendering — have no reader in this client: their settings rows
// were removed when it turned out nothing was behind them (docs/backlog.md says what each
// would take). They stay so that a file written here can still be read by a copy of the old
// client, and so the work is not lost track of. Do not add to that list: a field nobody
// reads and nobody has a plan for should simply go.
type App struct {
	Name               *string `json:"name"`
	Color              *string `json:"color"`
	AudioInputID       *string `json:"audioInputId"`
	AudioOutputID      *string `json:"audioOutputId"`
	VideoDeviceID      *string `json:"videoDeviceId"`
	DevicesConfigured  bool    `json:"devicesConfigured"`
	VideoOverlay       bool    `json:"videoOverlay"`
	AudioBackend       string  `json:"audioBackend"`
	AudioInputChannels string  `json:"audioInputChannels"`
	AudioInputGainDb   float64 `json:"audioInputGainDb"`
	AudioSendKbps      int     `json:"audioSendKbps"`
	AudioReceiveKbps   int     `json:"audioReceiveKbps"`
	ScreenSendKbps     int     `json:"screenSendKbps"`
	ScreenReceiveKbps  int     `json:"screenReceiveKbps"`
	NoiseSuppression   bool    `json:"noiseSuppression"`
	VoiceGate          bool    `json:"voiceGate"`
	// "system" — the platform's own voice processing, Apple's unit on macOS and the
	// communications category on Windows — or "raw". Absent means system, which is the
	// default; "apple", written by earlier versions, reads the same way.
	AudioProcessing string `json:"audioProcessing,omitempty"`
	// Our own levelling, for the platforms and devices whose driver has none: "auto" or "off".
	MicLevel string `json:"micLevel,omitempty"`
	// The Opus encoder's CPU lever, 1..10.
	OpusComplexity int `json:"opusComplexity,omitempty"`
	// A ceiling on a share's whole upload, in kbps; 0 (absent) is none, which is the
	// default: screenSendKbps is then what each person watching gets.
	ScreenUploadKbps int     `json:"screenUploadKbps,omitempty"`
	PauseRendering   string  `json:"pauseRendering"`
	AutoUpdate       string  `json:"autoUpdate"`
	LastUpdateCheck  int64   `json:"lastUpdateCheck"`
	LatestSeen       *string `json:"latestSeen"`
	LastRunVersion   *string `json:"lastRunVersion"`
}

func Defaults() App {
	return App{
		AudioBackend: "auto", AudioInputChannels: "auto",
		AudioSendKbps: 128, AudioReceiveKbps: 128, ScreenSendKbps: 2500, ScreenReceiveKbps: 2500,
		VoiceGate: true, PauseRendering: "minimized", AutoUpdate: "auto",
		AudioProcessing: "system", MicLevel: "auto", OpusComplexity: 10,
	}
}

// Dir is where settings.json lives.
func Dir() string {
	if runtime.GOOS == "windows" {
		if d := os.Getenv("APPDATA"); d != "" {
			return filepath.Join(d, "openmeet")
		}
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "openmeet")
}

func Path() string { return filepath.Join(Dir(), "settings.json") }

// Load reads the file over the defaults. A missing or unreadable file is the defaults.
func Load() App {
	s := Defaults()
	data, err := os.ReadFile(Path())
	if err != nil {
		return s
	}
	// Notepad and PowerShell write a UTF-8 BOM, which JSON refuses (gotcha 23).
	data = bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF})
	_ = json.Unmarshal(data, &s)
	return s
}

// Save writes the whole struct back. Callers mutate a loaded copy and save it.
func Save(s App) error {
	if err := os.MkdirAll(Dir(), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(Path(), append(data, '\n'), 0o644)
}

// Str is the string behind a nullable field, or "".
func Str(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// Ptr is the nullable form of a string, nil for "".
func Ptr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
