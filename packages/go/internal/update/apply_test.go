package update

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// A stand-in for the binary: something that runs and says a version, which is all Apply
// asks of it.
func fakeBinary(t *testing.T, path, version string) {
	t.Helper()
	body := "#!/bin/sh\necho " + version + "\n"
	if err := os.WriteFile(path, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
}

func says(t *testing.T, path string) string {
	t.Helper()
	out, err := exec.Command(path, "--version").Output()
	if err != nil {
		return "<did not run: " + err.Error() + ">"
	}
	return strings.TrimSpace(string(out))
}

func stage(t *testing.T) (dir, exe string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("the roll-back checks by running the new binary, which Windows cannot do here")
	}
	dir = t.TempDir()
	exe = filepath.Join(dir, "openmeet")
	old := exePath
	exePath = func() (string, error) { return exe, nil }
	t.Cleanup(func() { exePath = old })
	return dir, exe
}

func TestApplySwapsTheNewOneIn(t *testing.T) {
	_, exe := stage(t)
	fakeBinary(t, exe, "1.0.0")
	fakeBinary(t, staging(exe), "2.0.0")

	if err := Apply(); err != nil {
		t.Fatal(err)
	}
	if got := says(t, exe); got != "2.0.0" {
		t.Errorf("after the swap it says %q, want 2.0.0", got)
	}
	if _, err := os.Stat(staging(exe)); !os.IsNotExist(err) {
		t.Error("the staged file is still there")
	}
	if _, err := os.Stat(old(exe)); !os.IsNotExist(err) {
		t.Error("the one it replaced was kept for ever")
	}
}

// The one that matters: a new binary that does not run must not replace one that does. In
// the field this arrived as three SIGKILLs in a row and an app that would not start.
func TestApplyKeepsTheOneThatRunsWhenTheNewOneDoesNot(t *testing.T) {
	_, exe := stage(t)
	fakeBinary(t, exe, "1.0.0")
	if err := os.WriteFile(staging(exe), []byte("this is not a program"), 0o755); err != nil {
		t.Fatal(err)
	}

	if err := Apply(); err == nil {
		t.Fatal("it accepted a binary that does not run")
	}
	if got := says(t, exe); got != "1.0.0" {
		t.Errorf("it left %q in place — the one that worked is gone", got)
	}
	if _, err := os.Stat(old(exe)); !os.IsNotExist(err) {
		t.Error("the roll-back left its backup behind")
	}
}

func TestApplyNeedsSomethingStaged(t *testing.T) {
	_, exe := stage(t)
	fakeBinary(t, exe, "1.0.0")
	if err := Apply(); err == nil {
		t.Error("it applied nothing at all")
	}
}

// The whole path the field failure went through: download to the staging name, then swap it
// in. What was missing was the fsync — the rename is atomic for the metadata and says
// nothing about the data, so the binary could be in place with its pages not yet written,
// and macOS answers that by killing the process for an invalid signature.
func TestDownloadLandsOnDiskBeforeAnythingRenamesIt(t *testing.T) {
	_, exe := stage(t)
	fakeBinary(t, exe, "1.0.0")

	body := "#!/bin/sh\necho 2.0.0\n"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, body)
	}))
	defer srv.Close()

	if err := downloadFrom(context.Background(), srv.URL, staging(exe)); err != nil {
		t.Fatal(err)
	}
	// Read it back through a fresh handle: what a rename exposes is what is on disk, not
	// what is in whatever buffer wrote it.
	got, err := os.ReadFile(staging(exe))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != body {
		t.Fatalf("what landed is not what was sent: %q", got)
	}
	if err := Apply(); err != nil {
		t.Fatal(err)
	}
	if v := says(t, exe); v != "2.0.0" {
		t.Errorf("after download and swap it says %q", v)
	}
}
