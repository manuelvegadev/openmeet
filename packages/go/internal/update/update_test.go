package update

import (
	"testing"
	"time"
)

// memStore is the settings the updater keeps, without the file.
type memStore struct {
	last time.Time
	seen string
}

func (m *memStore) LastCheck() time.Time                 { return m.last }
func (m *memStore) LatestSeen() string                   { return m.seen }
func (m *memStore) SetCheck(at time.Time, latest string) { m.last, m.seen = at, latest }

func TestNewer(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"0.5.2", "0.5.3", true}, {"0.5.9", "0.5.10", true}, {"0.5.2", "0.5.2", false},
		{"0.5.3", "0.5.2", false}, {"0.5.2", "1.0.0", true}, {"dev", "0.5.3", false},
		{"0.5.2", "v0.6.0", true}, {"0.5.2", "0.6.0-rc1", true}, {"0.5.2", "garbage", false},
	}
	for _, c := range cases {
		if got := Newer(c.a, c.b); got != c.want {
			t.Errorf("Newer(%q, %q) = %v, want %v", c.a, c.b, got, c.want)
		}
	}
}

// A cached answer that is not a version is ignored rather than believed for a day: the
// repository's `releases/latest` answered `terminal-v0.5.2` before the first binary shipped,
// and a client that trusted it saw no updates at all until the cache expired.
func TestLatestIgnoresACachedNonVersion(t *testing.T) {
	st := &memStore{last: time.Now(), seen: "terminal-v0.5.2"}
	if cached := cachedLatest(st); cached != "" {
		t.Fatalf("a cached non-version was used as the latest release: %q", cached)
	}
	st.seen = "0.6.2"
	if cached := cachedLatest(st); cached != "0.6.2" {
		t.Fatalf("a fresh cached version should be used, got %q", cached)
	}
	st.last = time.Now().Add(-48 * time.Hour)
	if cached := cachedLatest(st); cached != "" {
		t.Fatalf("a stale cache should be asked again, got %q", cached)
	}
}
