package files

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Where a received file lands. Downloads is where a browser puts things and where people
// look; the subfolder is so a room's files can be found and deleted together.
const downloadFolder = "openmeet"

// DownloadDir is ~/Downloads/openmeet, created on first use.
func DownloadDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(home, "Downloads", downloadFolder)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

// Windows keeps a handful of names for devices, whatever the extension, and opening one does
// something other than what it looks like.
var reservedNames = map[string]bool{
	"con": true, "prn": true, "aux": true, "nul": true,
	"com1": true, "com2": true, "com3": true, "com4": true, "com5": true,
	"com6": true, "com7": true, "com8": true, "com9": true,
	"lpt1": true, "lpt2": true, "lpt3": true, "lpt4": true, "lpt5": true,
	"lpt6": true, "lpt7": true, "lpt8": true, "lpt9": true,
}

// SafeName turns the name a peer sent into one that is safe to create inside the download
// folder, and only there. The name arrives from someone the room has not authenticated, so
// none of it is trusted: the path parts go, the characters a filesystem gives meaning to go,
// and what is left cannot climb out of the directory it is joined to.
func SafeName(name string) string {
	// Both separators, whatever platform we are on: a name made on Windows reaches a Mac.
	name = strings.ReplaceAll(name, "\\", "/")
	if i := strings.LastIndex(name, "/"); i >= 0 {
		name = name[i+1:]
	}
	name = strings.Map(func(r rune) rune {
		switch {
		case r < 32 || r == 127:
			return -1
		case strings.ContainsRune(`<>:"/\|?*`, r):
			return '_'
		}
		return r
	}, name)
	// Windows drops trailing dots and spaces silently, which turns "report." into "report"
	// and a check on the name we thought we made into a lie.
	name = strings.TrimRight(name, ". ")
	name = strings.TrimSpace(name)
	if name == "" || name == "." || name == ".." {
		return "file"
	}
	if base := strings.ToLower(strings.TrimSuffix(name, filepath.Ext(name))); reservedNames[base] {
		name = "_" + name
	}
	if len(name) > 120 {
		ext := filepath.Ext(name)
		if len(ext) > 20 {
			ext = ""
		}
		name = name[:120-len(ext)] + ext
	}
	return name
}

// Destination is where to write an arriving file: inside the download folder, under a name
// nobody else is using. Two files called the same thing are numbered rather than one of them
// disappearing into the other.
func Destination(dir, name string) (string, error) {
	name = SafeName(name)
	full := filepath.Join(dir, name)
	// Belt and braces against a name that still resolves outside: what is created has to be
	// in the folder we meant, or nothing is created at all.
	if parent := filepath.Dir(full); filepath.Clean(parent) != filepath.Clean(dir) {
		return "", fmt.Errorf("bad file name")
	}
	if _, err := os.Stat(full); os.IsNotExist(err) {
		return full, nil
	}
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	for i := 2; i < 1000; i++ {
		try := filepath.Join(dir, fmt.Sprintf("%s (%d)%s", stem, i, ext))
		if _, err := os.Stat(try); os.IsNotExist(err) {
			return try, nil
		}
	}
	return "", fmt.Errorf("too many files called %s", name)
}
