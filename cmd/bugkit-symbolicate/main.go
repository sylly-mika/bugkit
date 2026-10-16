// Command bugkit-symbolicate resolves a minified JavaScript stack trace against a directory of source maps.
package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/sylly-mika/bugkit/sourcemap"
)

const usage = "usage: bugkit-symbolicate -maps DIR [FILE]"

func main() { os.Exit(run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr)) }

func run(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("bugkit-symbolicate", flag.ContinueOnError)
	fs.SetOutput(stderr)
	maps := fs.String("maps", "", "directory holding each source map at its script's URL path plus .map")
	fs.Usage = func() {
		fmt.Fprintln(stderr, usage)
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if *maps == "" || fs.NArg() > 1 {
		fs.Usage()
		return 2
	}
	if info, err := os.Stat(*maps); err != nil || !info.IsDir() {
		fmt.Fprintln(stderr, "bugkit-symbolicate: -maps must name a directory")
		return 2
	}
	var in []byte
	var err error
	if fs.NArg() == 1 {
		in, err = os.ReadFile(fs.Arg(0))
	} else {
		in, err = io.ReadAll(stdin)
	}
	if err != nil {
		fmt.Fprintf(stderr, "bugkit-symbolicate: %v\n", err)
		return 1
	}
	if _, err := io.WriteString(stdout, sourcemap.Symbolicate(string(in), sourcemap.DirLoader(*maps))); err != nil {
		return 1
	}
	return 0
}
