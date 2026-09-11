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
	// macOS: "apple" (the voice processing unit: Voice Isolation, echo cancellation, gain
	// — at ~10% of a core, measured; the default, and what an empty value means) or "raw"
	// (miniaudio, cheapest). Go client only.
	AudioProcessing string `json:"audioProcessing,omitempty"`
	// Our own levelling, for the platforms and devices whose driver has none: "auto" (the
	// default, including when the field is absent) or "off".
	MicLevel string `json:"micLevel,omitempty"`
	// The Opus encoder's CPU lever, 1..10; 0 (absent) means the default, 10.
	OpusComplexity  int     `json:"opusComplexity,omitempty"`
	PauseRendering  string  `json:"pauseRendering"`
	AutoUpdate      string  `json:"autoUpdate"`
	LastUpdateCheck int64   `json:"lastUpdateCheck"`
	LatestSeen      *string `json:"latestSeen"`
	LastRunVersion  *string `json:"lastRunVersion"`
}

func Defaults() App {
	return App{
		AudioBackend: "auto", AudioInputChannels: "auto",
		AudioSendKbps: 128, AudioReceiveKbps: 128, ScreenSendKbps: 2500, ScreenReceiveKbps: 2500,
		VoiceGate: true, PauseRendering: "minimized", AutoUpdate: "auto",
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
