// Package sourcemap reads source map v3 files and index maps and maps a generated position back to its source.
package sourcemap

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
)

// ErrUnsupported is returned for a source map version other than 3 or an index map section that names a url.
var ErrUnsupported = errors.New("sourcemap: unsupported source map")

// Map is a parsed source map. It is read-only after Parse and safe for concurrent use.
type Map struct {
	sources  []string
	names    []string
	lines    [][]segment
	index    bool
	sections []section
}

// Position is a place in an original source file. Line and Column are 1-based.
type Position struct {
	Source       string
	Line, Column int
	Name         string
}

type segment struct{ genColumn, source, line, column, name int }
type section struct {
	line, column int
	m            *Map
}

type rawMap struct {
	Version    int          `json:"version"`
	Sources    []string     `json:"sources"`
	SourceRoot string       `json:"sourceRoot"`
	Names      []string     `json:"names"`
	Mappings   string       `json:"mappings"`
	Sections   []rawSection `json:"sections"`
}

type rawSection struct {
	Offset struct {
		Line   int `json:"line"`
		Column int `json:"column"`
	} `json:"offset"`
	URL *string         `json:"url"`
	Map json.RawMessage `json:"map"`
}

// Parse reads a source map v3 or an index map.
func Parse(data []byte) (*Map, error) {
	var raw rawMap
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("sourcemap: %w", err)
	}
	if raw.Version != 3 {
		return nil, fmt.Errorf("%w: version %d", ErrUnsupported, raw.Version)
	}
	if raw.Sections != nil {
		return parseIndex(raw.Sections)
	}
	sources := make([]string, len(raw.Sources))
	for i, s := range raw.Sources {
		if raw.SourceRoot != "" && s != "" {
			s = strings.TrimSuffix(raw.SourceRoot, "/") + "/" + s
		}
		sources[i] = s
	}
	lines, err := parseMappings(raw.Mappings, len(sources), len(raw.Names))
	if err != nil {
		return nil, err
	}
	return &Map{sources: sources, names: raw.Names, lines: lines}, nil
}

func parseIndex(raws []rawSection) (*Map, error) {
	m := &Map{index: true, sections: make([]section, 0, len(raws))}
	for i, rs := range raws {
		if rs.URL != nil {
			return nil, fmt.Errorf("%w: section %d has a url", ErrUnsupported, i)
		}
		if len(rs.Map) == 0 || string(rs.Map) == "null" {
			return nil, fmt.Errorf("sourcemap: section %d has no map", i)
		}
		line, column := rs.Offset.Line, rs.Offset.Column
		if line < 0 || column < 0 {
			return nil, fmt.Errorf("sourcemap: section %d has a negative offset", i)
		}
		if i > 0 {
			prev := m.sections[i-1]
			if line < prev.line || (line == prev.line && column <= prev.column) {
				return nil, fmt.Errorf("sourcemap: section %d starts before the one above it", i)
			}
		}
		sub, err := Parse(rs.Map)
		if err != nil {
			return nil, fmt.Errorf("sourcemap: section %d: %w", i, err)
		}
		m.sections = append(m.sections, section{line: line, column: column, m: sub})
	}
	return m, nil
}

func parseMappings(s string, nSources, nNames int) ([][]segment, error) {
	var lines [][]segment
	var cur []segment
	var genCol, src, origLine, origCol, name int
	i := 0
	for {
		gl := len(lines) + 1
		if i == len(s) || s[i] == ';' {
			sort.SliceStable(cur, func(a, b int) bool { return cur[a].genColumn < cur[b].genColumn })
			lines = append(lines, cur)
			cur = nil
			genCol = 0
			if i == len(s) {
				return lines, nil
			}
			i++
			continue
		}
		if s[i] == ',' {
			i++
			continue
		}
		var vals []int
		for i < len(s) && s[i] != ',' && s[i] != ';' {
			v, next, err := decodeVLQ(s, i)
			if err != nil {
				return nil, fmt.Errorf("sourcemap: mappings line %d: %w", gl, err)
			}
			vals = append(vals, v)
			i = next
		}
		n := len(vals)
		if n != 1 && n != 4 && n != 5 {
			return nil, fmt.Errorf("sourcemap: mappings line %d: segment has %d fields", gl, n)
		}
		genCol += vals[0]
		if genCol < 0 {
			return nil, fmt.Errorf("sourcemap: mappings line %d: negative value", gl)
		}
		seg := segment{genColumn: genCol, source: -1, name: -1}
		if n >= 4 {
			src += vals[1]
			origLine += vals[2]
			origCol += vals[3]
			if origLine < 0 || origCol < 0 {
				return nil, fmt.Errorf("sourcemap: mappings line %d: negative value", gl)
			}
			if src < 0 || src >= nSources {
				return nil, fmt.Errorf("sourcemap: mappings line %d: index out of range", gl)
			}
			seg.source, seg.line, seg.column = src, origLine, origCol
		}
		if n == 5 {
			name += vals[4]
			if name < 0 || name >= nNames {
				return nil, fmt.Errorf("sourcemap: mappings line %d: index out of range", gl)
			}
			seg.name = name
		}
		cur = append(cur, seg)
	}
}

// Lookup returns the source position of a 1-based generated line and column.
func (m *Map) Lookup(line, column int) (Position, bool) {
	if m == nil || line < 1 || column < 1 {
		return Position{}, false
	}
	l0, c0 := line-1, column-1
	if m.index {
		return m.lookupSection(l0, c0)
	}
	if l0 >= len(m.lines) {
		return Position{}, false
	}
	segs := m.lines[l0]
	k := sort.Search(len(segs), func(i int) bool { return segs[i].genColumn > c0 }) - 1
	if k < 0 || segs[k].source < 0 {
		return Position{}, false
	}
	s := segs[k]
	p := Position{Source: m.sources[s.source], Line: s.line + 1, Column: s.column + 1}
	if s.name >= 0 {
		p.Name = m.names[s.name]
	}
	return p, true
}

func (m *Map) lookupSection(l0, c0 int) (Position, bool) {
	j := sort.Search(len(m.sections), func(i int) bool {
		s := m.sections[i]
		return s.line > l0 || (s.line == l0 && s.column > c0)
	}) - 1
	if j < 0 {
		return Position{}, false
	}
	sec := m.sections[j]
	if l0 == sec.line {
		c0 -= sec.column
	}
	return sec.m.Lookup(l0-sec.line+1, c0+1)
}
