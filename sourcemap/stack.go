package sourcemap

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// Loader returns the source map of the script served at a URL path.
type Loader func(scriptPath string) ([]byte, error)

var (
	errEmptyPath  = errors.New("sourcemap: empty script path")
	errParentPath = errors.New("sourcemap: script path may not hold ..")
)

var framePattern = regexp.MustCompile(`^(.*):(\d+):(\d+)\)?$`)

// DirLoader returns a Loader that reads dir/<scriptPath>.map and refuses a path holding a .. segment.
func DirLoader(dir string) Loader {
	return func(scriptPath string) ([]byte, error) {
		rel := strings.TrimLeft(scriptPath, "/")
		if rel == "" {
			return nil, errEmptyPath
		}
		for _, seg := range strings.FieldsFunc(rel, func(r rune) bool { return r == '/' || r == '\\' }) {
			if seg == ".." {
				return nil, errParentPath
			}
		}
		return os.ReadFile(filepath.Join(dir, filepath.FromSlash(rel)+".map"))
	}
}

// Symbolicate appends to each stack line the source position of its last URL:line:column frame, loading each script's map once.
func Symbolicate(stack string, load Loader) string {
	if load == nil {
		return stack
	}
	maps := map[string]*Map{}
	lines := strings.Split(stack, "\n")
	for i, line := range lines {
		body, cr := strings.CutSuffix(line, "\r")
		path, l, c, ok := lastFrame(body)
		if !ok {
			continue
		}
		m, seen := maps[path]
		if !seen {
			m = loadMap(load, path)
			maps[path] = m
		}
		if m == nil {
			continue
		}
		pos, ok := m.Lookup(l, c)
		if !ok {
			continue
		}
		suffix := fmt.Sprintf("    => %s:%d:%d", pos.Source, pos.Line, pos.Column)
		if pos.Name != "" {
			suffix += " " + pos.Name
		}
		if cr {
			suffix += "\r"
		}
		lines[i] = body + suffix
	}
	return strings.Join(lines, "\n")
}

func loadMap(load Loader, path string) *Map {
	data, err := load(path)
	if err != nil {
		return nil
	}
	m, err := Parse(data)
	if err != nil {
		return nil
	}
	return m
}

func lastFrame(line string) (scriptPath string, l, c int, ok bool) {
	fields := strings.Fields(line)
	for i := len(fields) - 1; i >= 0; i-- {
		g := framePattern.FindStringSubmatch(fields[i])
		if g == nil {
			continue
		}
		ln, errL := strconv.Atoi(g[2])
		col, errC := strconv.Atoi(g[3])
		if errL != nil || errC != nil || ln < 1 || col < 1 {
			return "", 0, 0, false
		}
		path := scriptPathOf(g[1])
		if path == "" {
			return "", 0, 0, false
		}
		return path, ln, col, true
	}
	return "", 0, 0, false
}

func scriptPathOf(location string) string {
	urlText := location
	if i := strings.LastIndex(location, "://"); i >= 0 {
		start := i
		for start > 0 {
			b := location[start-1]
			if !(b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9' || b == '+' || b == '-' || b == '.') {
				break
			}
			start--
		}
		urlText = location[start:]
	} else if i := strings.LastIndexAny(location, "@("); i >= 0 {
		urlText = location[i+1:]
	}
	u, err := url.Parse(urlText)
	if err != nil {
		return ""
	}
	return u.Path
}
