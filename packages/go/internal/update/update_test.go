package update

import "testing"

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
