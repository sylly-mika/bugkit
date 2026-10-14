package bugkit

import (
	"net/http"
	"strings"
	"testing"
)

func TestRefusal422OnBadFields(t *testing.T) {
	cases := []struct {
		name   string
		edit   func(map[string]string)
		detail string
	}{
		{"description blank", func(f map[string]string) { f["description"] = "   " }, "A description is required."},
		{"description too long", func(f map[string]string) { f["description"] = strings.Repeat("é", 5001) }, "Description must be at most 5000 characters."},
		{"impact not allowed", func(f map[string]string) { f["impact"] = "urgent" }, "Impact must be one of blocks, workaround or cosmetic."},
		{"impact absent", func(f map[string]string) { delete(f, "impact") }, "Impact must be one of blocks, workaround or cosmetic."},
		{"area empty", func(f map[string]string) { f["area"] = "" }, "An area is required."},
		{"area not a path", func(f map[string]string) { f["area"] = "sites/1" }, `Area must be a route path starting with "/".`},
		{"area too long", func(f map[string]string) { f["area"] = "/" + strings.Repeat("a", 512) }, "Area must be at most 512 characters."},
		{"diagnostics absent", func(f map[string]string) { delete(f, "diagnostics") }, "Diagnostics must be JSON."},
		{"diagnostics not JSON", func(f map[string]string) { f["diagnostics"] = "{not json" }, "Diagnostics must be JSON."},
		{"diagnostics too big", func(f map[string]string) { f["diagnostics"] = `"` + strings.Repeat("a", 32767) + `"` }, "Diagnostics must be at most 32 KiB."},
		{"version too long", func(f map[string]string) { f["version"] = strings.Repeat("v", 129) }, "Version must be at most 128 characters."},
		{"viewport too long", func(f map[string]string) { f["viewport"] = strings.Repeat("1", 65) }, "Viewport must be at most 64 characters."},
		{"request id too long", func(f map[string]string) { f["request_id"] = strings.Repeat("r", 129) }, "Request id must be at most 128 characters."},
		{"description before impact", func(f map[string]string) { f["description"] = ""; f["impact"] = "urgent" }, "A description is required."},
		{"area before diagnostics", func(f map[string]string) { f["area"] = "x"; f["diagnostics"] = "nope" }, `Area must be a route path starting with "/".`},
		{"version before request id", func(f map[string]string) {
			f["version"] = strings.Repeat("v", 129)
			f["request_id"] = strings.Repeat("r", 129)
		}, "Version must be at most 128 characters."},
		{"kind not allowed", func(f map[string]string) { f["kind"] = "urgent" }, "Kind must be bug or feature."},
		{"kind wrong case", func(f map[string]string) { f["kind"] = "Bug" }, "Kind must be bug or feature."},
		{"summary too long", func(f map[string]string) { f["summary"] = strings.Repeat("é", 201) }, "Summary must be at most 200 characters."},
		{"kind before description", func(f map[string]string) { f["kind"] = "x"; f["description"] = "" }, "Kind must be bug or feature."},
		{"summary before description", func(f map[string]string) { f["summary"] = strings.Repeat("s", 201); f["description"] = "" }, "Summary must be at most 200 characters."},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			sink := newFakeSink()
			fields := validParts()
			c.edit(fields)
			rec := post(t, Config{Sink: sink, Who: whoMiky}, fields, nil)
			assertProblem(t, rec, http.StatusUnprocessableEntity, c.detail)
			if sink.calls != 0 {
				t.Fatalf("sink calls = %d, want 0", sink.calls)
			}
		})
	}
}

func TestSummaryCapCountsRunesAndFollowsTheLimits(t *testing.T) {
	sink := newFakeSink()
	fields := validParts()
	fields["summary"] = strings.Repeat("é", 200)
	if rec := post(t, Config{Sink: sink, Who: whoMiky}, fields, nil); rec.Code != http.StatusCreated {
		t.Fatalf("200 runes: status = %d, want 201\n%s", rec.Code, rec.Body.String())
	}

	cfg := Config{Sink: sink, Who: whoMiky, Limits: Limits{Summary: 10}}
	fields["summary"] = strings.Repeat("s", 11)
	assertProblem(t, post(t, cfg, fields, nil), http.StatusUnprocessableEntity, "Summary must be at most 10 characters.")

	fields["summary"] = strings.Repeat("s", 10)
	if rec := post(t, cfg, fields, nil); rec.Code != http.StatusCreated {
		t.Fatalf("10 runes with Summary limit 10: status = %d, want 201\n%s", rec.Code, rec.Body.String())
	}
}

func TestCapsCountRunesAndBytes(t *testing.T) {
	sink := newFakeSink()
	fields := validParts()
	fields["description"] = strings.Repeat("é", 5000)
	fields["area"] = "/" + strings.Repeat("a", 511)
	fields["diagnostics"] = `"` + strings.Repeat("a", 32766) + `"`
	fields["version"] = strings.Repeat("é", 128)
	fields["viewport"] = strings.Repeat("1", 64)
	fields["request_id"] = strings.Repeat("é", 128)
	rec := post(t, Config{Sink: sink, Who: whoMiky}, fields, nil)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201\n%s", rec.Code, rec.Body.String())
	}
	if sink.got.Description != strings.Repeat("é", 5000) {
		t.Errorf("Description has %d runes, want 5000", len([]rune(sink.got.Description)))
	}
	if sink.got.RequestID != strings.Repeat("é", 128) {
		t.Errorf("RequestID has %d runes, want 128", len([]rune(sink.got.RequestID)))
	}
}

func TestHandlerUsesTheConfiguredLimits(t *testing.T) {
	want := Limits{Summary: 200, Description: 5000, Area: 512, Version: 128, Viewport: 64, RequestID: 128, UserAgent: 256, Diagnostics: 32768, Screenshot: 5242880}
	if got := DefaultLimits(); got != want {
		t.Fatalf("DefaultLimits() = %+v, want %+v", got, want)
	}

	sink := newFakeSink()
	cfg := Config{Sink: sink, Who: whoMiky, Limits: Limits{Description: 10}}

	fields := validParts()
	fields["description"] = "12345678901"
	assertProblem(t, post(t, cfg, fields, nil), http.StatusUnprocessableEntity, "Description must be at most 10 characters.")

	fields = validParts()
	fields["description"] = "1234567890"
	fields["area"] = "/" + strings.Repeat("a", 511)
	if rec := post(t, cfg, fields, nil); rec.Code != http.StatusCreated {
		t.Fatalf("zero Area limit: status = %d, want 201\n%s", rec.Code, rec.Body.String())
	}
}

func TestRefusal422OnAScreenshotThatIsNotPNG(t *testing.T) {
	sink := newFakeSink()
	rec := post(t, Config{Sink: sink, Who: whoMiky}, validParts(), []byte("GIF89a not a png"))
	assertProblem(t, rec, http.StatusUnprocessableEntity, "Screenshot must be a PNG image.")
	if sink.calls != 0 {
		t.Fatalf("sink calls = %d, want 0", sink.calls)
	}
}

func TestRefusal413OnAnOversizeScreenshot(t *testing.T) {
	sink := newFakeSink()

	// (a) default limits
	assertProblem(t, post(t, Config{Sink: sink, Who: whoMiky}, validParts(), pngOfSize(5242881)),
		http.StatusRequestEntityTooLarge, "The screenshot is larger than 5 MiB.")

	// (b) and (c): a 64-byte cap
	cfg := Config{Sink: sink, Who: whoMiky, Limits: Limits{Screenshot: 64}}
	assertProblem(t, post(t, cfg, validParts(), pngOfSize(65)),
		http.StatusRequestEntityTooLarge, "The screenshot is larger than 64 bytes.")
	if sink.calls != 0 {
		t.Fatalf("sink calls = %d before the accepted report, want 0", sink.calls)
	}
	if rec := post(t, cfg, validParts(), pngOfSize(64)); rec.Code != http.StatusCreated {
		t.Fatalf("64-byte screenshot: status = %d, want 201\n%s", rec.Code, rec.Body.String())
	}
	if len(sink.got.Screenshot) != 64 {
		t.Errorf("Screenshot has %d bytes, want 64", len(sink.got.Screenshot))
	}
	if sink.calls != 1 {
		t.Fatalf("sink calls = %d, want 1", sink.calls)
	}
}

func TestRefusal413OnAnOversizeBody(t *testing.T) {
	sink := newFakeSink()

	// (a) default limits: the body cap is the screenshot cap plus 1 MiB
	fields := validParts()
	fields["padding"] = strings.Repeat("a", 6291457)
	assertProblem(t, post(t, Config{Sink: sink, Who: whoMiky}, fields, nil),
		http.StatusRequestEntityTooLarge, "The report is larger than 6 MiB.")

	// (b) a 64-byte screenshot cap gives a body cap of 64 bytes plus 1 MiB
	fields = validParts()
	fields["padding"] = strings.Repeat("a", 1048641)
	assertProblem(t, post(t, Config{Sink: sink, Who: whoMiky, Limits: Limits{Screenshot: 64}}, fields, nil),
		http.StatusRequestEntityTooLarge, "The report is larger than 1048640 bytes.")

	if sink.calls != 0 {
		t.Fatalf("sink calls = %d, want 0", sink.calls)
	}
}

func TestSizeTextNamesTheUnit(t *testing.T) {
	sink := newFakeSink()

	fields := validParts()
	fields["diagnostics"] = `"` + strings.Repeat("a", 2047) + `"`
	assertProblem(t, post(t, Config{Sink: sink, Who: whoMiky, Limits: Limits{Diagnostics: 2048}}, fields, nil),
		http.StatusUnprocessableEntity, "Diagnostics must be at most 2 KiB.")

	fields = validParts()
	fields["diagnostics"] = `"` + strings.Repeat("a", 99) + `"`
	assertProblem(t, post(t, Config{Sink: sink, Who: whoMiky, Limits: Limits{Diagnostics: 100}}, fields, nil),
		http.StatusUnprocessableEntity, "Diagnostics must be at most 100 bytes.")
}
