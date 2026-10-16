package tests

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/sylly-mika/bugkit/sourcemap"
)

func readFixtureMap(t *testing.T, name string) *sourcemap.Map {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", "sourcemap", name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	m, err := sourcemap.Parse(data)
	if err != nil {
		t.Fatalf("Parse(%s): %v", name, err)
	}
	return m
}

func mustParse(t *testing.T, js string) *sourcemap.Map {
	t.Helper()
	m, err := sourcemap.Parse([]byte(js))
	if err != nil {
		t.Fatalf("Parse(%q): %v", js, err)
	}
	return m
}

func wantAt(t *testing.T, m *sourcemap.Map, line, column int, want sourcemap.Position) {
	t.Helper()
	got, ok := m.Lookup(line, column)
	if !ok || got != want {
		t.Fatalf("Lookup(%d,%d) = %+v, %v; want %+v, true", line, column, got, ok, want)
	}
}

func wantMiss(t *testing.T, m *sourcemap.Map, line, column int) {
	t.Helper()
	got, ok := m.Lookup(line, column)
	if ok || got != (sourcemap.Position{}) {
		t.Fatalf("Lookup(%d,%d) = %+v, %v; want a miss", line, column, got, ok)
	}
}

func TestSourcemapLookupFindsTheSourceLine(t *testing.T) {
	m := readFixtureMap(t, "basic.map")
	wantAt(t, m, 1, 1, sourcemap.Position{Source: "src/a.ts", Line: 1, Column: 1})
	wantAt(t, m, 1, 15, sourcemap.Position{Source: "src/a.ts", Line: 3, Column: 5, Name: "greet"})
	wantAt(t, m, 3, 5, sourcemap.Position{Source: "src/b.ts", Line: 10, Column: 1, Name: "main"})
}

func TestSourcemapLookupTakesTheSegmentAtTheColumn(t *testing.T) {
	m := readFixtureMap(t, "basic.map")
	wantAt(t, m, 1, 9, sourcemap.Position{Source: "src/a.ts", Line: 1, Column: 1})
	wantAt(t, m, 1, 10, sourcemap.Position{Source: "src/a.ts", Line: 3, Column: 5, Name: "greet"})
	wantAt(t, m, 3, 3, sourcemap.Position{Source: "src/b.ts", Line: 10, Column: 1, Name: "main"})
}

func TestSourcemapRelativeFieldsRunOnAcrossLines(t *testing.T) {
	m := readFixtureMap(t, "basic.map")
	wantAt(t, m, 3, 15, sourcemap.Position{Source: "src/a.ts", Line: 5, Column: 3})
	wantAt(t, m, 3, 40, sourcemap.Position{Source: "src/a.ts", Line: 5, Column: 3})
}

func TestSourcemapOneFieldSegmentMisses(t *testing.T) {
	m := readFixtureMap(t, "basic.map")
	wantMiss(t, m, 1, 21)
	wantMiss(t, m, 1, 99)
}

func TestSourcemapLookupOutsideTheMappingsMisses(t *testing.T) {
	m := readFixtureMap(t, "basic.map")
	wantMiss(t, m, 2, 1)
	wantMiss(t, m, 3, 2)
	wantMiss(t, m, 4, 1)
	wantMiss(t, m, 0, 1)
	wantMiss(t, m, 1, 0)
	wantMiss(t, m, -1, 5)
	if got, ok := (*sourcemap.Map)(nil).Lookup(1, 1); ok || got != (sourcemap.Position{}) {
		t.Fatalf("nil Map Lookup(1,1) = %+v, %v; want a miss", got, ok)
	}
}

func TestSourcemapSectionsOffsetTheFirstLine(t *testing.T) {
	m := readFixtureMap(t, "sections.map")
	wantAt(t, m, 1, 1, sourcemap.Position{Source: "one.ts", Line: 1, Column: 1})
	wantAt(t, m, 2, 6, sourcemap.Position{Source: "two.ts", Line: 1, Column: 1})
	wantAt(t, m, 2, 9, sourcemap.Position{Source: "two.ts", Line: 7, Column: 3, Name: "x"})
}

func TestSourcemapSectionColumnOffsetOnlyOnItsFirstLine(t *testing.T) {
	m := readFixtureMap(t, "sections.map")
	wantAt(t, m, 3, 2, sourcemap.Position{Source: "two.ts", Line: 9, Column: 1})
	wantMiss(t, m, 3, 1)
}

func TestSourcemapSectionStartsAtItsOffset(t *testing.T) {
	m := readFixtureMap(t, "sections.map")
	wantAt(t, m, 2, 1, sourcemap.Position{Source: "one.ts", Line: 2, Column: 1})
	wantAt(t, m, 2, 5, sourcemap.Position{Source: "one.ts", Line: 2, Column: 1})
}

func TestSourcemapSourceRootPrefixesSources(t *testing.T) {
	m := mustParse(t, `{"version":3,"sourceRoot":"webpack://app/","sources":["src/x.ts"],"names":[],"mappings":"AAAA"}`)
	wantAt(t, m, 1, 1, sourcemap.Position{Source: "webpack://app/src/x.ts", Line: 1, Column: 1})
	m = mustParse(t, `{"version":3,"sourceRoot":"lib","sources":["y.ts"],"names":[],"mappings":"AAAA"}`)
	wantAt(t, m, 1, 1, sourcemap.Position{Source: "lib/y.ts", Line: 1, Column: 1})
}

func TestSourcemapSortsTheSegmentsOfALine(t *testing.T) {
	m := mustParse(t, `{"version":3,"sources":["u.ts"],"names":[],"mappings":"UACA,VADA"}`)
	wantAt(t, m, 1, 5, sourcemap.Position{Source: "u.ts", Line: 1, Column: 1})
	wantAt(t, m, 1, 11, sourcemap.Position{Source: "u.ts", Line: 2, Column: 1})
}

func TestSourcemapRefusesUnsupported(t *testing.T) {
	cases := []struct {
		name string
		js   []string
	}{
		{"version", []string{
			`{"version":2,"sources":[],"names":[],"mappings":""}`,
			`{"sources":[],"names":[],"mappings":""}`,
		}},
		{"section url", []string{
			`{"version":3,"sections":[{"offset":{"line":0,"column":0},"url":"chunk.js.map"}]}`,
		}},
		{"section version", []string{
			`{"version":3,"sections":[{"offset":{"line":0,"column":0},"map":{"version":2,"sources":[],"names":[],"mappings":""}}]}`,
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			for _, js := range c.js {
				m, err := sourcemap.Parse([]byte(js))
				if m != nil || !errors.Is(err, sourcemap.ErrUnsupported) {
					t.Fatalf("Parse(%q) = %v, %v; want nil and ErrUnsupported", js, m, err)
				}
			}
		})
	}
}

func TestSourcemapRefusesBadMaps(t *testing.T) {
	cases := []struct {
		name string
		js   string
	}{
		{"bad digit", `{"version":3,"sources":["a.ts"],"names":[],"mappings":"g!A"}`},
		{"cut short", `{"version":3,"sources":["a.ts"],"names":[],"mappings":"g"}`},
		{"too large", `{"version":3,"sources":["a.ts"],"names":[],"mappings":"ggggggggA"}`},
		{"two fields", `{"version":3,"sources":["a.ts"],"names":[],"mappings":"AA"}`},
		{"six fields", `{"version":3,"sources":["a.ts"],"names":[],"mappings":"AAAAAA"}`},
		{"source out of range", `{"version":3,"sources":["a.ts"],"names":[],"mappings":"ACAA"}`},
		{"name out of range", `{"version":3,"sources":["a.ts"],"names":[],"mappings":"AAAAA"}`},
		{"negative column", `{"version":3,"sources":["a.ts"],"names":[],"mappings":"DAAA"}`},
		{"negative source line", `{"version":3,"sources":["a.ts"],"names":[],"mappings":"AADA"}`},
		{"section without map", `{"version":3,"sections":[{"offset":{"line":0,"column":0}}]}`},
		{"sections out of order", `{"version":3,"sections":[` +
			`{"offset":{"line":0,"column":0},"map":{"version":3,"sources":[],"names":[],"mappings":""}},` +
			`{"offset":{"line":0,"column":0},"map":{"version":3,"sources":[],"names":[],"mappings":""}}]}`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			m, err := sourcemap.Parse([]byte(c.js))
			if m != nil {
				t.Fatalf("Parse(%q) returned a Map; want nil", c.js)
			}
			if err == nil || !strings.HasPrefix(err.Error(), "sourcemap: ") {
				t.Fatalf("Parse(%q) error = %v; want a sourcemap: error", c.js, err)
			}
			if errors.Is(err, sourcemap.ErrUnsupported) {
				t.Fatalf("Parse(%q) error = %v; want not ErrUnsupported", c.js, err)
			}
		})
	}
}

func TestSourcemapLookupIsSafeForConcurrentUse(t *testing.T) {
	m := readFixtureMap(t, "basic.map")
	want := sourcemap.Position{Source: "src/a.ts", Line: 3, Column: 5, Name: "greet"}
	var wg sync.WaitGroup
	for g := 0; g < 8; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 200; i++ {
				got, ok := m.Lookup(1, 10)
				if !ok || got != want {
					t.Errorf("Lookup(1,10) = %+v, %v; want %+v, true", got, ok, want)
					return
				}
			}
		}()
	}
	wg.Wait()
}
