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

// cache is a list kept for a minute. Enumerating a machine's devices is not free — the
// Windows screens are a PowerShell call at about a second, the macOS ones an ffmpeg spawn
// at about a third — and the settings screen asks whenever it draws.
type cache struct {
	mu   sync.Mutex
	at   time.Time
	list []Device
}

func (c *cache) get(fill func() []Device) []Device {
	c.mu.Lock()
	defer c.mu.Unlock()
	if time.Since(c.at) < time.Minute && c.list != nil {
		return c.list
	}
	c.list = fill()
	c.at = time.Now()
	return c.list
}

var (
	screensCache cache
	camerasCache cache
	// On macOS one ffmpeg listing answers both, so it is cached once and they take a half
	// each rather than spawning it twice on two clocks.
	avCache struct {
		mu               sync.Mutex
		at               time.Time
		cameras, screens []Device
	}
)

func avDevices() (cameras, screens []Device) {
	avCache.mu.Lock()
	defer avCache.mu.Unlock()
	if time.Since(avCache.at) < time.Minute && avCache.cameras != nil {
		return avCache.cameras, avCache.screens
	}
	avCache.cameras, avCache.screens = avfoundationDevices()
	avCache.at = time.Now()
	return avCache.cameras, avCache.screens
}

// Screens lists the displays.
func Screens() []Device {
	return screensCache.get(func() []Device {
		switch runtime.GOOS {
		case "darwin":
			return macScreens()
		case "windows":
			return windowsScreens()
		}
		return nil
	})
}

// Cameras lists the cameras avfoundation sees; macOS only.
func Cameras() []Device {
	if runtime.GOOS != "darwin" {
		return nil
	}
	return camerasCache.get(func() []Device {
		cams, _ := avDevices()
		return cams
	})
}

// ByID is the device with that id, or nil: turning a saved id back into a name.
func ByID(list []Device, id string) *Device {
	for i := range list {
		if list[i].ID == id {
			return &list[i]
		}
	}
	return nil
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
	_, screens := avDevices()
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
