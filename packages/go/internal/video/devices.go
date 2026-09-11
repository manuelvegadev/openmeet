package video

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// A screen or a camera, as the capture path names it.
type Device struct {
	ID      string // avfoundation index on macOS, monitor index on Windows
	Name    string
	Width   int
	Height  int
	Primary bool
}

// Label is what a picker shows: the monitor's own name, its size, which one is the main.
func (d Device) Label() string {
	size := ""
	if d.Width > 0 && d.Height > 0 {
		size = fmt.Sprintf(" %dx%d", d.Width, d.Height)
	}
	main := ""
	if d.Primary {
		main = " · main"
	}
	return d.Name + size + main
}

var (
	screensMu   sync.Mutex
	screensAt   time.Time
	screensList []Device
)

// Screens lists the displays, cached a minute: the Windows enumeration is a PowerShell
// call and costs about a second.
func Screens() []Device {
	screensMu.Lock()
	defer screensMu.Unlock()
	if time.Since(screensAt) < time.Minute && screensList != nil {
		return screensList
	}
	switch runtime.GOOS {
	case "darwin":
		screensList = macScreens()
	case "windows":
		screensList = windowsScreens()
	default:
		screensList = nil
	}
	screensAt = time.Now()
	return screensList
}

var (
	camerasMu   sync.Mutex
	camerasAt   time.Time
	camerasList []Device
)

// Cameras lists the cameras avfoundation sees; macOS only. Cached a minute like the
// screens, because it spawns ffmpeg and the settings screen asks on every frame it draws.
func Cameras() []Device {
	if runtime.GOOS != "darwin" {
		return nil
	}
	camerasMu.Lock()
	defer camerasMu.Unlock()
	if time.Since(camerasAt) < time.Minute && camerasList != nil {
		return camerasList
	}
	camerasList, _ = avfoundationDevices()
	camerasAt = time.Now()
	return camerasList
}

var avLine = regexp.MustCompile(`\[(\d+)\] (.+)$`)

// avfoundationDevices parses ffmpeg's device listing, which exits non-zero by design.
func avfoundationDevices() (cameras, screens []Device) {
	cmd := exec.Command(Ffmpeg(), "-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", "")
	out, _ := cmd.CombinedOutput()
	inVideo := false
	for _, line := range strings.Split(string(out), "\n") {
		if strings.Contains(line, "AVFoundation video devices") {
			inVideo = true
			continue
		}
		if strings.Contains(line, "AVFoundation audio devices") {
			break
		}
		if !inVideo {
			continue
		}
		m := avLine.FindStringSubmatch(strings.TrimSpace(line))
		if m == nil {
			continue
		}
		d := Device{ID: m[1], Name: m[2]}
		if strings.HasPrefix(d.Name, "Capture screen") {
			screens = append(screens, d)
		} else {
			cameras = append(cameras, d)
		}
	}
	return
}

// macScreens: avfoundation's "Capture screen N" carries no name or size; system_profiler
// knows both, in the same order. Where the counts differ the avfoundation names stay.
func macScreens() []Device {
	_, screens := avfoundationDevices()
	out, err := exec.Command("system_profiler", "SPDisplaysDataType", "-json").Output()
	if err != nil {
		return screens
	}
	var sp struct {
		SPDisplaysDataType []struct {
			Displays []struct {
				Name string `json:"_name"`
				Res  string `json:"_spdisplays_resolution"`
				Main string `json:"spdisplays_main"`
			} `json:"spdisplays_ndrvs"`
		} `json:"SPDisplaysDataType"`
	}
	if json.Unmarshal(out, &sp) != nil {
		return screens
	}
	var infos []struct{ name, res, main string }
	for _, gpu := range sp.SPDisplaysDataType {
		for _, d := range gpu.Displays {
			infos = append(infos, struct{ name, res, main string }{d.Name, d.Res, d.Main})
		}
	}
	if len(infos) != len(screens) {
		return screens
	}
	res := regexp.MustCompile(`(\d+) ?x ?(\d+)`)
	for i := range screens {
		screens[i].Name = infos[i].name
		if m := res.FindStringSubmatch(infos[i].res); m != nil {
			screens[i].Width, _ = strconv.Atoi(m[1])
			screens[i].Height, _ = strconv.Atoi(m[2])
		}
		screens[i].Primary = infos[i].main == "spdisplays_yes"
	}
	return screens
}

// windowsScreens: Screen.AllScreens with DPI awareness, in physical pixels, the way the
// Node client asked (gotcha 23). Index is the order DXGI uses on a single adapter.
func windowsScreens() []Device {
	script := `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::EnableVisualStyles(); ` +
		`try { Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class DPI { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'; [DPI]::SetProcessDPIAware() | Out-Null } catch {}; ` +
		`$i=0; [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { [PSCustomObject]@{ i=$i; name=$_.DeviceName; w=$_.Bounds.Width; h=$_.Bounds.Height; x=$_.Bounds.X; y=$_.Bounds.Y; primary=$_.Primary }; $i++ } | ConvertTo-Json -Compress`
	out, err := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script).Output()
	if err != nil {
		return nil
	}
	text := strings.TrimSpace(string(out))
	if !strings.HasPrefix(text, "[") {
		text = "[" + text + "]"
	}
	var rows []struct {
		I       int    `json:"i"`
		Name    string `json:"name"`
		W, H    int
		X, Y    int
		Primary bool `json:"primary"`
	}
	if json.Unmarshal([]byte(text), &rows) != nil {
		return nil
	}
	var out2 []Device
	for _, r := range rows {
		name := strings.TrimPrefix(r.Name, `\\.\`)
		out2 = append(out2, Device{ID: strconv.Itoa(r.I), Name: name, Width: r.W, Height: r.H, Primary: r.Primary})
	}
	return out2
}
