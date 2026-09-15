package files

import (
	"encoding/base64"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf16"
)

// The clipboard on Windows is Windows PowerShell's, because the clipboard APIs need an STA
// thread and PowerShell 5.1 gives one for free. Win+Shift+S — the Snipping Tool — leaves a
// bitmap there, which is the common way a screenshot gets shared on this platform.
//
// The script goes over as -EncodedCommand: base64 of UTF-16, which is the one way to hand
// PowerShell a script with quotes in it and not think about quoting at all.

func powershell() string { return winPath("System32", "WindowsPowerShell", "v1.0", "powershell.exe") }

func clipboardFile() (string, error) {
	dst := filepath.Join(os.TempDir(), fmt.Sprintf("openmeet-clip-%d.png", time.Now().Unix()))
	script := `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
if ([Windows.Forms.Clipboard]::ContainsFileDropList()) {
  $list = [Windows.Forms.Clipboard]::GetFileDropList()
  if ($list.Count -gt 0) { Write-Output $list[0]; exit }
}
$img = [Windows.Forms.Clipboard]::GetImage()
if ($img -ne $null) {
  $img.Save('` + dst + `', [System.Drawing.Imaging.ImageFormat]::Png)
  $img.Dispose()
  Write-Output '` + dst + `'
}
`
	cmd := exec.Command(powershell(), "-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand", encodeUTF16(script))
	out, err := cmd.Output()
	if err != nil {
		return "", nil
	}
	path := strings.TrimSpace(string(out))
	if path == "" {
		return "", nil
	}
	if _, err := os.Stat(path); err != nil {
		return "", nil
	}
	return path, nil
}

func encodeUTF16(s string) string {
	u := utf16.Encode([]rune(s))
	b := make([]byte, 0, len(u)*2)
	for _, r := range u {
		b = append(b, byte(r), byte(r>>8))
	}
	return base64.StdEncoding.EncodeToString(b)
}
