package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNormalizeLang(t *testing.T) {
	cases := []struct {
		tag  string
		want string
	}{
		{"ru", "ru"},
		{"ru-RU", "ru"},
		{"EN-GB", "en"},
		{"es-419", "es"},
		{"zh", "zh-Hans"},
		{"zh-CN", "zh-Hans"},
		{"zh-TW", "zh-Hant"},
		{"zh-HK", "zh-Hant"},
		{"zh-Hant-TW", "zh-Hant"},
		{"pt", "pt-BR"},
		{"pt-BR", "pt-BR"},
		{"pt-PT", "pt-PT"},
		// Serbian is not split by script: both scripts summarize the same language.
		{"sr-Latn", "sr"},
		{"sr-Cyrl-RS", "sr"},
		// Legacy codes browsers still emit for languages the whitelist spells the
		// modern way.
		{"no", "nb"},
		{"nb-NO", "nb"},
		{"iw", "he"},
		{"fil-PH", "tl"},
	}
	for _, testCase := range cases {
		if got := normalizeLang(testCase.tag); got != testCase.want {
			t.Errorf("normalizeLang(%q) = %q, want %q", testCase.tag, got, testCase.want)
		}
	}
}

// Length is counted in code points on both sides of the wire. Bytes would reject
// Cyrillic and CJK text the client legitimately let through; UTF-16 units would
// double-count emoji.
func TestCheckLengthCountsCodePoints(t *testing.T) {
	cfg = &config{minInput: 5, maxInput: 10}

	cases := []struct {
		name string
		text string
		want errorCode
	}{
		{name: "ascii within range", text: "abcdefg", want: ""},
		{name: "cyrillic within range, though twice as many bytes", text: "привет", want: ""},
		{name: "emoji counted once each", text: "👋👋👋👋👋", want: ""},
		{name: "too short", text: "abcd", want: errTooShort},
		{name: "too long", text: strings.Repeat("я", 11), want: errTooLong},
	}
	for _, testCase := range cases {
		if got := checkLength(testCase.text); got != testCase.want {
			t.Errorf("%s: checkLength = %q, want %q", testCase.name, got, testCase.want)
		}
	}
}

func TestParseShortenRequest(t *testing.T) {
	cfg = &config{
		minInput:  1,
		maxInput:  100,
		languages: map[string]bool{"en": true, "ru": true, "pt-br": true},
	}

	const deviceID = "3f1a6b2c-9d4e-4a1b-8c2d-5e6f7a8b9c0d"
	validBody := `{"text":"some text","lang":"ru-RU","tone":"original","source":"selection"}`

	cases := []struct {
		name    string
		body    string
		headers map[string]string
		want    errorCode
	}{
		{name: "valid request", body: validBody, want: ""},
		{name: "body is not JSON", body: `{`, want: errInvalidRequest},
		{name: "text missing", body: `{"lang":"ru","tone":"original","source":"page"}`, want: errInvalidRequest},
		{name: "text of the wrong type", body: `{"text":42,"lang":"ru","tone":"original","source":"page"}`, want: errInvalidRequest},
		{name: "unknown field", body: `{"text":"t","lang":"ru","tone":"original","source":"page","extra":1}`, want: errInvalidRequest},
		{name: "tone outside the set", body: `{"text":"t","lang":"ru","tone":"shouting","source":"page"}`, want: errInvalidRequest},
		{name: "source outside the set", body: `{"text":"t","lang":"ru","tone":"original","source":"clipboard"}`, want: errInvalidRequest},
		{name: "device id missing", body: validBody, headers: map[string]string{"X-Device-Id": ""}, want: errInvalidRequest},
		{name: "device id is not UUIDv4", body: validBody, headers: map[string]string{"X-Device-Id": "not-a-uuid"}, want: errInvalidRequest},
		// A language the server does not serve is its own code, not invalid_request:
		// the client is not broken, the language is simply not offered.
		{name: "language outside the list", body: `{"text":"t","lang":"is","tone":"original","source":"page"}`, want: errUnsupportedLanguage},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/v1/shorten", strings.NewReader(testCase.body))
			request.Header.Set("X-Device-Id", deviceID)
			for name, value := range testCase.headers {
				request.Header.Set(name, value)
			}

			_, got := parseShortenRequest(request)
			if got != testCase.want {
				t.Fatalf("got %q, want %q", got, testCase.want)
			}
		})
	}
}

func TestParseShortenRequestNormalizesAndTrims(t *testing.T) {
	cfg = &config{minInput: 1, maxInput: 100, languages: map[string]bool{"ru": true}}

	request := httptest.NewRequest(http.MethodPost, "/v1/shorten",
		strings.NewReader(`{"text":"  padded  ","lang":"ru-RU","tone":"formal","source":"manual"}`))
	request.Header.Set("X-Device-Id", "3f1a6b2c-9d4e-4a1b-8c2d-5e6f7a8b9c0d")
	request.Header.Set("CloudFront-Viewer-Country", "DE")

	parsed, code := parseShortenRequest(request)
	if code != "" {
		t.Fatalf("unexpected error code %q", code)
	}
	if parsed.text != "padded" {
		t.Errorf("text = %q, want %q", parsed.text, "padded")
	}
	if parsed.lang != "ru" {
		t.Errorf("lang = %q, want %q", parsed.lang, "ru")
	}
	if parsed.country != "DE" {
		t.Errorf("country = %q, want DE", parsed.country)
	}
}
