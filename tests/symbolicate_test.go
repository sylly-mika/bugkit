package tests

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/sylly-mika/bugkit/sourcemap"
)

const symbolicateAppMap = `{"version":3,"file":"app.js","sourceRoot":"","sources":["src/a.ts","src/b.ts"],"names":["greet","main"],"mappings":"AAAA,SAEIA,W;;ECOJC,YDLE"}`

const symbolicateChunkMap = `{"version":3,"file":"chunk.js","sections":[{"offset":{"line":0,"column":0},"map":{"version":3,"sources":["one.ts"],"names":[],"mappings":"AAAA;AACA"}},{"offset":{"line":1,"column":5},"map":{"version":3,"sources":["two.ts"],"names":["x"],"mappings":"AAAA,GAMEA;CAEF"}}]}`

func symbolicateMaps(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	maps := filepath.Join(root, "maps")
	files := map[string]string{
		"_next/static/chunks/app.js.map":              symbolicateAppMap,
		"_next/static/chunks/app/(shop)/chunk.js.map": symbolicateChunkMap,
	}
	for rel, content := range files {
		path := filepath.Join(maps, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return maps
}

func readStack(t *testing.T, name string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", "sourcemap", name))
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestSymbolicateV8Stack(t *testing.T) {
	got := sourcemap.Symbolicate(readStack(t, "stack-v8.txt"), sourcemap.DirLoader(symbolicateMaps(t)))
	want := readStack(t, "stack-v8-want.txt")
	if got != want {
		t.Errorf("got\n%s\nwant\n%s", got, want)
	}
}

func TestSymbolicateFirefoxStack(t *testing.T) {
	got := sourcemap.Symbolicate(readStack(t, "stack-firefox.txt"), sourcemap.DirLoader(symbolicateMaps(t)))
	want := readStack(t, "stack-firefox-want.txt")
	if got != want {
		t.Errorf("got\n%s\nwant\n%s", got, want)
	}
}

func TestSymbolicateLoadsEachScriptOnce(t *testing.T) {
	counts := map[string]int{}
	inner := sourcemap.DirLoader(symbolicateMaps(t))
	load := func(scriptPath string) ([]byte, error) {
		counts[scriptPath]++
		return inner(scriptPath)
	}
	got := sourcemap.Symbolicate(readStack(t, "stack-v8.txt"), load)
	want := readStack(t, "stack-v8-want.txt")
	if got != want {
		t.Errorf("got\n%s\nwant\n%s", got, want)
	}
	for _, path := range []string{"/_next/static/chunks/app.js", "/_next/static/chunks/app/(shop)/chunk.js", "/_next/static/chunks/missing.js"} {
		if _, ok := counts[path]; !ok {
			t.Errorf("loader was not asked for %q; asked for %v", path, counts)
		}
	}
	for path, n := range counts {
		if n != 1 {
			t.Errorf("loader asked for %q %d times, want 1", path, n)
		}
		if strings.Contains(path, "?") || strings.Contains(path, "://") {
			t.Errorf("loader asked for %q, want a URL path with no query or scheme", path)
		}
	}
}

func TestSymbolicateKeepsOtherLinesByteForByte(t *testing.T) {
	load := sourcemap.DirLoader(symbolicateMaps(t))
	a := "Error: boom\n    at f (https://shop.example/_next/static/chunks/missing.js:1:1)\n\n  no frame here: 1:2\n"
	if got := sourcemap.Symbolicate(a, load); got != a {
		t.Errorf("got\n%q\nwant\n%q", got, a)
	}
	b := "    at greet (https://shop.example/_next/static/chunks/app.js:1:15)\r\nnext"
	wantB := "    at greet (https://shop.example/_next/static/chunks/app.js:1:15)    => src/a.ts:3:5 greet\r\nnext"
	if got := sourcemap.Symbolicate(b, load); got != wantB {
		t.Errorf("got\n%q\nwant\n%q", got, wantB)
	}
	if got := sourcemap.Symbolicate(a, nil); got != a {
		t.Errorf("nil loader: got\n%q\nwant\n%q", got, a)
	}
}

func TestSymbolicateTakesTheLastFrameOnALine(t *testing.T) {
	in := "    at https://shop.example/_next/static/chunks/app.js:1:15 https://shop.example/_next/static/chunks/app.js:3:5"
	want := in + "    => src/b.ts:10:1 main"
	if got := sourcemap.Symbolicate(in, sourcemap.DirLoader(symbolicateMaps(t))); got != want {
		t.Errorf("got\n%q\nwant\n%q", got, want)
	}
}

func TestSymbolicateSkipsACutColumn(t *testing.T) {
	in := "    at greet (https://shop.example/_next/static/chunks/app.js:1:1…"
	if got := sourcemap.Symbolicate(in, sourcemap.DirLoader(symbolicateMaps(t))); got != in {
		t.Errorf("got\n%q\nwant\n%q", got, in)
	}
}

func TestSymbolicateDirLoaderStaysInsideTheDirectory(t *testing.T) {
	maps := symbolicateMaps(t)
	if err := os.WriteFile(filepath.Join(filepath.Dir(maps), "secret.js.map"), []byte(symbolicateAppMap), 0o644); err != nil {
		t.Fatal(err)
	}
	in := "    at f (https://shop.example/../secret.js:1:15)\n" +
		"    at g (https://shop.example/%2e%2e/secret.js:1:15)\n" +
		"    at h (/../secret.js:1:15)"
	if got := sourcemap.Symbolicate(in, sourcemap.DirLoader(maps)); got != in {
		t.Errorf("got\n%s\nwant\n%s", got, in)
	}
	load := sourcemap.DirLoader(maps)
	for _, path := range []string{"/../secret.js", "a/../../secret.js", "/a\\..\\..\\secret.js"} {
		data, err := load(path)
		if data != nil || err == nil {
			t.Errorf("DirLoader(%q) = %d bytes, %v; want nil data and an error", path, len(data), err)
		}
	}
	data, err := load("/_next/static/chunks/app.js")
	if err != nil {
		t.Fatalf("control: %v", err)
	}
	if string(data) != symbolicateAppMap {
		t.Errorf("control: got %q, want the app map", data)
	}
}
