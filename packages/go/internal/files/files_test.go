package files

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestKindByExtension(t *testing.T) {
	for name, want := range map[string]string{
		"nota.m4a": KindAudio, "TRACK.MP3": KindAudio, "clip.mov": KindVideo,
		"build.tar.gz": KindArchive, "notes.txt": KindOther, "noext": KindOther,
		"screenshot.png": KindImage, "photo.JPEG": KindImage,
	} {
		if got := Kind(name); got != want {
			t.Errorf("Kind(%q) = %q, want %q", name, got, want)
		}
	}
}

// The name arrives from someone the room has not authenticated, so none of it is trusted.
func TestSafeNameCannotEscapeOrTrick(t *testing.T) {
	cases := map[string]string{
		"../../etc/passwd":       "passwd",
		`..\..\Windows\evil.exe`: "evil.exe",
		"/etc/hosts":             "hosts",
		"":                       "file",
		".":                      "file",
		"..":                     "file",
		"a\nb.txt":               "ab.txt",
		"re:port?.txt":           "re_port_.txt",
		"report.":                "report",
		"trailing   ":            "trailing",
		"con.txt":                "_con.txt",
		"NUL":                    "_NUL",
	}
	for in, want := range cases {
		if got := SafeName(in); got != want {
			t.Errorf("SafeName(%q) = %q, want %q", in, got, want)
		}
	}
	if got := SafeName(strings.Repeat("x", 400) + ".txt"); len(got) > 120 || !strings.HasSuffix(got, ".txt") {
		t.Errorf("a very long name should be cut and keep its extension, got %d chars %q", len(got), got[max(0, len(got)-10):])
	}
}

func TestDestinationNumbersRatherThanOverwrites(t *testing.T) {
	dir := t.TempDir()
	first, err := Destination(dir, "notes.txt")
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(first) != "notes.txt" {
		t.Fatalf("first = %q", first)
	}
	if err := os.WriteFile(first, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	second, err := Destination(dir, "notes.txt")
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(second) != "notes (2).txt" {
		t.Fatalf("second = %q, want notes (2).txt", filepath.Base(second))
	}
}

func TestDestinationStaysInTheFolder(t *testing.T) {
	dir := t.TempDir()
	got, err := Destination(dir, "../../escaped.txt")
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(got) != filepath.Clean(dir) {
		t.Fatalf("%q is outside %q", got, dir)
	}
}

func TestFormatSize(t *testing.T) {
	for n, want := range map[int64]string{
		14: "14 B", 2048: "2 KB", 1572864: "1.5 MB", 2147483648: "2.0 GB",
	} {
		if got := FormatSize(n); got != want {
			t.Errorf("FormatSize(%d) = %q, want %q", n, got, want)
		}
	}
}

// A file dropped on a terminal arrives as its path, escaped the way that terminal escapes.
func TestAttachUnderstandsHowTerminalsWritePaths(t *testing.T) {
	dir := t.TempDir()
	plain := filepath.Join(dir, "notes.txt")
	spaced := filepath.Join(dir, "my notes.txt")
	for _, p := range []string{plain, spaced} {
		if err := os.WriteFile(p, []byte("hello"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	if got, ok := Attach(plain); !ok || len(got) != 1 || got[0].Path != plain {
		t.Fatalf("a plain path: %v %v", got, ok)
	}
	if got, ok := Attach(`"` + spaced + `"`); !ok || len(got) != 1 || got[0].Path != spaced {
		t.Fatalf("a quoted path, as Windows Terminal writes one: %v %v", got, ok)
	}
	if runtime.GOOS != "windows" {
		escaped := strings.ReplaceAll(spaced, " ", `\ `)
		if got, ok := Attach(escaped); !ok || len(got) != 1 || got[0].Path != spaced {
			t.Fatalf("an escaped path, as Terminal.app writes one: %v %v", got, ok)
		}
	}
	// Two at once, and the sizes and kinds that go on their chips.
	both := `"` + plain + `" "` + spaced + `"`
	got, ok := Attach(both)
	if !ok || len(got) != 2 {
		t.Fatalf("two files: %v %v", got, ok)
	}
	if got[0].Size != 5 || got[0].Kind != KindOther {
		t.Errorf("attachment = %+v", got[0])
	}
}

func TestAttachSaysNoToOrdinaryText(t *testing.T) {
	for _, s := range []string{"", "hello there", "/no/such/file", "a\nb"} {
		if _, ok := Attach(s); ok {
			t.Errorf("Attach(%q) claimed a file", s)
		}
	}
	// One that exists and one that does not is all text: half a drop turning into a chip and
	// half into a message would be worse than either.
	dir := t.TempDir()
	real := filepath.Join(dir, "a.txt")
	if err := os.WriteFile(real, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, ok := Attach(real + " /no/such/file"); ok {
		t.Error("a half-resolving drop should be text")
	}
}

func TestAttachRefusesAFolder(t *testing.T) {
	if _, ok := Attach(t.TempDir()); ok {
		t.Error("a folder is not a file to send")
	}
}

// The round trip: what is written is what arrives, and the digest says so.
func TestSendAndReceive(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "payload.bin")
	body := bytes.Repeat([]byte("openmeet"), 9000) // not a multiple of the chunk
	if err := os.WriteFile(src, body, 0o644); err != nil {
		t.Fatal(err)
	}
	meta, err := Describe(src)
	if err != nil {
		t.Fatal(err)
	}
	if meta.Size != int64(len(body)) {
		t.Fatalf("size %d", meta.Size)
	}
	sum := sha256.Sum256(body)
	if meta.SHA256 != hex.EncodeToString(sum[:]) {
		t.Fatal("digest does not match the bytes")
	}

	var wire bytes.Buffer
	var lastSent int64
	if err := Send(src, &wire, nil, meta.Size, func(n int64) { lastSent = n }); err != nil {
		t.Fatal(err)
	}
	if lastSent != meta.Size {
		t.Errorf("progress ended at %d of %d", lastSent, meta.Size)
	}
	dst := filepath.Join(dir, "arrived.bin")
	if err := Receive(&wire, meta.Size, meta.SHA256, dst, nil); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(dst)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, body) {
		t.Error("what arrived is not what was sent")
	}
}

func TestReceiveRefusesWhatDoesNotMatch(t *testing.T) {
	dir := t.TempDir()
	dst := filepath.Join(dir, "arrived.bin")
	body := []byte("not the file you were promised")
	err := Receive(bytes.NewReader(body), int64(len(body)), strings.Repeat("0", 64), dst, nil)
	if err == nil {
		t.Fatal("a digest that does not match must fail")
	}
	if _, err := os.Stat(dst); !os.IsNotExist(err) {
		t.Error("a failed transfer left a file behind")
	}
	if _, err := os.Stat(dst + ".part"); !os.IsNotExist(err) {
		t.Error("a failed transfer left its part file behind")
	}
}

func TestReceiveRefusesMoreThanWasOffered(t *testing.T) {
	dir := t.TempDir()
	dst := filepath.Join(dir, "arrived.bin")
	// The sender says 10 bytes and sends 5000. Taking the first ten and calling it done
	// would be worse than failing: the disk is not theirs to fill, and a file that does not
	// match what was announced is not the file that was announced.
	err := Receive(bytes.NewReader(bytes.Repeat([]byte("x"), 5000)), 10, "", dst, nil)
	if err == nil {
		t.Fatal("a sender sending more than they offered must fail")
	}
	if _, err := os.Stat(dst); !os.IsNotExist(err) {
		t.Error("it left a file behind")
	}
}

func TestReceiveNoticesATruncatedTransfer(t *testing.T) {
	dir := t.TempDir()
	dst := filepath.Join(dir, "arrived.bin")
	err := Receive(bytes.NewReader([]byte("short")), 500, "", dst, nil)
	if err == nil {
		t.Fatal("a transfer that stopped early must fail")
	}
	if _, err := os.Stat(dst); !os.IsNotExist(err) {
		t.Error("a truncated transfer left a file that looks complete")
	}
}

func TestDescribeRefusesWhatCannotBeSent(t *testing.T) {
	if _, err := Describe(t.TempDir()); err == nil {
		t.Error("a folder is not a file")
	}
	if _, err := Describe(filepath.Join(t.TempDir(), "nope")); err == nil {
		t.Error("a missing file is not a file")
	}
}

// A ceiling that moves while the transfer runs is the whole point of asking for it per
// chunk: the call decides what the file may have, second by second.
func TestSendFollowsACeilingThatMoves(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "payload.bin")
	if err := os.WriteFile(src, bytes.Repeat([]byte("x"), 8*ChunkSize), 0o644); err != nil {
		t.Fatal(err)
	}
	asked := 0
	var wire bytes.Buffer
	if err := Send(src, &wire, func() int { asked++; return 0 }, 8*ChunkSize, nil); err != nil {
		t.Fatal(err)
	}
	if asked < 8 {
		t.Errorf("the ceiling was asked for %d times, want one per chunk", asked)
	}
	if wire.Len() != 8*ChunkSize {
		t.Errorf("sent %d bytes", wire.Len())
	}
}

// The rate ceiling is what keeps a transfer from taking the call's uplink with it.
func TestSendHonoursItsCeiling(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "payload.bin")
	// 64 KiB at 512 kbps is a second of sending; measured loosely, since the point is only
	// that the ceiling is applied at all.
	if err := os.WriteFile(src, bytes.Repeat([]byte("x"), 64*1024), 0o644); err != nil {
		t.Fatal(err)
	}
	var wire bytes.Buffer
	done := make(chan error, 1)
	go func() { done <- Send(src, &wire, func() int { return 512 }, 64*1024, nil) }()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if wire.Len() != 64*1024 {
		t.Fatalf("sent %d bytes", wire.Len())
	}
}

var _ io.Reader = (*bytes.Buffer)(nil)
