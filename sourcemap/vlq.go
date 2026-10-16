package sourcemap

import (
	"errors"
	"strings"
)

const vlqAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

var (
	errVLQDigit = errors.New("bad base64 digit")
	errVLQShort = errors.New("value cut short")
	errVLQLarge = errors.New("value too large")
)

func decodeVLQ(s string, i int) (value, next int, err error) {
	var acc, shift int
	for n := 0; ; n++ {
		if i >= len(s) {
			return 0, i, errVLQShort
		}
		if n == 7 {
			return 0, i, errVLQLarge
		}
		d := strings.IndexByte(vlqAlphabet, s[i])
		if d < 0 {
			return 0, i, errVLQDigit
		}
		i++
		acc |= (d & 31) << shift
		shift += 5
		if d&32 == 0 {
			break
		}
	}
	value = acc >> 1
	if acc&1 == 1 {
		value = -value
	}
	return value, i, nil
}
