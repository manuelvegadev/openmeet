// Package video is screen and camera over WebRTC: ffmpeg captures and encodes H.264 on
// the machine's hardware encoder, pion carries it, ffplay shows what peers send. Nothing
// here decodes or scales a frame in Go — the Node client did, and paid for it on the
// audio loop (gotcha 24b).
package video

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

// Where a tool is, resolved once: the PATH first, then where winget and the installer put
// ffmpeg on Windows (Explorer's PATH is stale, gotcha 31).
var (
	toolsMu   sync.Mutex
	toolPaths = map[string]string{}
)

func FindTool(name string) string {
	toolsMu.Lock()
	defer toolsMu.Unlock()
	if p, ok := toolPaths[name]; ok {
		return p
	}
	p, err := exec.LookPath(name)
	if err != nil && runtime.GOOS == "windows" {
		for _, dir := range []string{
			filepath.Join(os.Getenv("LOCALAPPDATA"), "Microsoft", "WinGet", "Links"),
			filepath.Join(os.Getenv("ProgramFiles"), "ffmpeg", "bin"),
		} {
			if c := filepath.Join(dir, name+".exe"); fileExists(c) {
				p, err = c, nil
				break
			}
		}
	}
	if err != nil {
		p = ""
	}
	toolPaths[name] = p
	return p
}

func fileExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

func Ffmpeg() string { return FindTool("ffmpeg") }
func Ffplay() string { return FindTool("ffplay") }

// Available says whether the pipeline can run here at all.
func Available() bool { return Ffmpeg() != "" && Ffplay() != "" }

// Encoder is the H.264 encoder ffmpeg has, hardware first: VideoToolbox on macOS, NVENC,
// AMF or QuickSync on Windows, libx264 as the software fallback. Resolved once.
var (
	encoderOnce sync.Once
	encoder     string
)

func Encoder() string {
	encoderOnce.Do(func() {
		out, _ := exec.Command(Ffmpeg(), "-hide_banner", "-encoders").Output()
		have := string(out)
		for _, name := range []string{"h264_videotoolbox", "h264_nvenc", "h264_amf", "h264_qsv", "libx264"} {
			if strings.Contains(have, " "+name+" ") {
				encoder = name
				return
			}
		}
	})
	return encoder
}

// Hardware says whether the encoder in use is one.
func Hardware() bool { return Encoder() != "" && Encoder() != "libx264" }
