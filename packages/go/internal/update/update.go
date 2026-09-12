// Package update keeps the binary current from GitHub Releases: once a day it asks for the
// latest tag, downloads the platform's asset beside the running binary, checks that what
// came down runs and reports the version it should, and only then says so — the home
// screen never promises an install it has not already downloaded (the Node client's rule,
// lib/update.ts). The swap happens when the app is gone: at exit, or on `r`, which swaps
// and starts the new one with the same arguments. On Windows a running executable can be
// renamed but not overwritten, so the old one is moved aside and deleted on the next start.
package update

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const (
	repo = "manuelvegadev/openmeet"
	// Long enough not to ask twice when the app starts twice in a row, short enough that
	// opening it is how you find out there is a new version.
	askAgainAfter = 5 * time.Minute
	checkTimeout  = 3 * time.Second
)

// Status is what the home screen shows: a newer version, and whether it is ready to install.
type Status struct {
	Version string
	Ready   bool
	// When not installing on our own: how to.
	Command string
}

// Store is what the check reads and writes: the daily cache.
type Store interface {
	LastCheck() time.Time
	LatestSeen() string
	SetCheck(at time.Time, latest string)
}

// AssetName is the release file for this machine.
func AssetName() string {
	switch runtime.GOOS + "/" + runtime.GOARCH {
	case "darwin/arm64":
		return "openmeet-darwin-arm64"
	case "windows/amd64":
		return "openmeet-windows-amd64.exe"
	}
	return ""
}

// Exe is the running binary's real path.
func Exe() (string, error) {
	p, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.EvalSymlinks(p)
}

func staging(exe string) string {
	if runtime.GOOS == "windows" {
		return strings.TrimSuffix(exe, ".exe") + ".new.exe"
	}
	return exe + ".new"
}

func old(exe string) string {
	if runtime.GOOS == "windows" {
		return strings.TrimSuffix(exe, ".exe") + ".old.exe"
	}
	return exe + ".old"
}

// CleanupOld removes what the last swap left behind.
func CleanupOld() {
	if exe, err := Exe(); err == nil {
		_ = os.Remove(old(exe))
	}
}

// Newer says whether b is a later version than a: numeric per component, so 0.5.10 beats
// 0.5.9. Anything that is not a version (a "dev" build) is never behind.
func Newer(a, b string) bool {
	pa, pb := parse(a), parse(b)
	if pa == nil || pb == nil {
		return false
	}
	for i := 0; i < 3; i++ {
		if pb[i] != pa[i] {
			return pb[i] > pa[i]
		}
	}
	return false
}

func parse(v string) []int {
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	parts := strings.SplitN(v, "-", 2)[0]
	fields := strings.Split(parts, ".")
	if len(fields) != 3 {
		return nil
	}
	out := make([]int, 3)
	for i, f := range fields {
		n, err := strconv.Atoi(f)
		if err != nil {
			return nil
		}
		out[i] = n
	}
	return out
}

// Latest asks the registry — GitHub — for the newest tag, or takes the day's cached answer.
// Latest is the newest released version, asked of GitHub at most once a day.
//
// Both halves refuse an answer that is not a version, and they have to: `releases/latest`
// answers with whatever release is newest in the repository, which is not necessarily this
// client's. Before the first binary went out it answered `terminal-v0.5.2` — the retired npm
// package's tag — and a client that cached that string went a whole day comparing its version
// against something unreadable, which reads as "no update" and hides every release until the
// cache expires.
// cachedLatest is the last answer, when it is recent enough and reads as a version.
func cachedLatest(st Store) string {
	seen := st.LatestSeen()
	if parse(seen) != nil && time.Since(st.LastCheck()) < askAgainAfter {
		return seen
	}
	return ""
}

// Latest is the newest released version: asked of GitHub on every start, which is the point
// of having an updater at all. The stored answer is a floor against asking twice in the same
// breath — a relaunch after an update, mostly — and a fallback for a machine with no network,
// not a daily budget: the request is a kilobyte with a three-second deadline on a goroutine
// nobody is waiting for.
//
// It refuses an answer that is not a version, and has to: `releases/latest` gives whatever
// release is newest in the repository, which is not necessarily this client's. Before the
// first binary went out it answered `terminal-v0.5.2`, the retired npm package's tag, and a
// client that believed it compared its version against something unreadable — which reads as
// "no update" and hid every release for as long as the answer was kept.
func Latest(ctx context.Context, st Store, mode Mode) (string, error) {
	if seen := cachedLatest(st); mode == Startup && seen != "" {
		return seen, nil
	}
	latest, err := fetchLatest(ctx)
	if err != nil {
		// No network, or GitHub is unhappy: the last answer we could read beats none.
		if seen := st.LatestSeen(); parse(seen) != nil {
			return seen, nil
		}
		return "", err
	}
	st.SetCheck(time.Now(), latest)
	return latest, nil
}

func fetchLatest(ctx context.Context) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, checkTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/repos/"+repo+"/releases/latest", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("releases: HTTP %d", resp.StatusCode)
	}
	var rel struct {
		Tag string `json:"tag_name"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return "", err
	}
	latest := strings.TrimPrefix(rel.Tag, "v")
	if parse(latest) == nil {
		return "", fmt.Errorf("releases: latest is %q, which is not this client's", rel.Tag)
	}
	return latest, nil
}

// Check runs the whole policy: nothing for "off" or a dev build; for "notify" the version
// and the command; for "auto" the download, verified, and then the version as ready.
// Mode says whether the floor applies: a start honours it, a person asking does not.
type Mode int

const (
	Startup Mode = iota
	Asked
)

func Check(ctx context.Context, policy, current string, st Store, mode Mode, log func(string, ...any)) *Status {
	if policy == "off" || parse(current) == nil || AssetName() == "" {
		return nil
	}
	latest, err := Latest(ctx, st, mode)
	if err != nil {
		log("update check: %v", err)
		return nil
	}
	if !Newer(current, latest) {
		return nil
	}
	if policy != "auto" {
		return &Status{Version: latest, Command: installCommand()}
	}
	exe, err := Exe()
	if err != nil {
		return &Status{Version: latest, Command: installCommand()}
	}
	if err := download(ctx, latest, staging(exe)); err != nil {
		log("update download: %v", err)
		return &Status{Version: latest, Command: installCommand()}
	}
	// Only a binary that runs and says the right version counts as downloaded.
	out, err := exec.Command(staging(exe), "--version").Output()
	if err != nil || strings.TrimSpace(string(out)) != latest {
		_ = os.Remove(staging(exe))
		log("update: downloaded binary did not verify (%v, %q)", err, strings.TrimSpace(string(out)))
		return &Status{Version: latest, Command: installCommand()}
	}
	return &Status{Version: latest, Ready: true}
}

func download(ctx context.Context, version, to string) error {
	url := fmt.Sprintf("https://github.com/%s/releases/download/v%s/%s", repo, version, AssetName())
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("%s: HTTP %d", url, resp.StatusCode)
	}
	f, err := os.OpenFile(to, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, resp.Body); err != nil {
		f.Close()
		_ = os.Remove(to)
		return err
	}
	return f.Close()
}

// Pending is the staged binary's path when one is waiting, "" otherwise.
func Pending() string {
	exe, err := Exe()
	if err != nil {
		return ""
	}
	if st, err := os.Stat(staging(exe)); err == nil && st.Size() > 0 {
		return staging(exe)
	}
	return ""
}

// Apply swaps the staged binary in. Call it once the app has let go of everything.
func Apply() error {
	exe, err := Exe()
	if err != nil {
		return err
	}
	pending := staging(exe)
	if _, err := os.Stat(pending); err != nil {
		return err
	}
	if runtime.GOOS == "windows" {
		_ = os.Remove(old(exe))
		if err := os.Rename(exe, old(exe)); err != nil {
			return err
		}
		if err := os.Rename(pending, exe); err != nil {
			_ = os.Rename(old(exe), exe) // put it back
			return err
		}
		return nil
	}
	return os.Rename(pending, exe)
}

// Relaunch starts the (new) binary with the same arguments and returns; the caller exits.
// Relaunch starts the installed version in this terminal and stays until it is done.
//
// The waiting is the point. A shell decides a command has finished when the process it
// started exits, and prints its prompt there and then — so a parent that starts the new
// version and leaves hands the terminal back while the child is painting on it, and the
// prompt lands in the middle of the room. Holding the console until the child is done costs
// an idle process and keeps the terminal one program's.
func Relaunch() error {
	exe, err := Exe()
	if err != nil {
		return err
	}
	cmd := exec.Command(exe, os.Args[1:]...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	if err := cmd.Start(); err != nil {
		return err
	}
	// The child owns the keyboard now, ctrl-c included.
	signal.Ignore(os.Interrupt)
	_ = cmd.Wait()
	return nil
}

// What to tell someone whose policy says do not install: the same line the site shows, which
// redirects to the installer in the latest release rather than naming a path in the repo.
func installCommand() string {
	if runtime.GOOS == "windows" {
		return "irm https://openmeet.manuelvega.dev/install.ps1 | iex"
	}
	return "curl -fsSL https://openmeet.manuelvega.dev/install | bash"
}
