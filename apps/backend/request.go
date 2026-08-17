package main

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

type summarizeRequest struct {
	text           string
	lang           string // normalized, canonical case
	ratio          string
	source         string
	deviceID       string
	catalogVersion int
	country        string
}

// requestBody uses pointers so that a missing field and an empty one are different
// things: a missing text is a broken client (invalid_request), an empty one is a
// length problem (too_short).
type requestBody struct {
	Text   *string `json:"text"`
	Lang   *string `json:"lang"`
	Ratio  *string `json:"ratio"`
	Source *string `json:"source"`
}

var uuidV4Pattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)

// parseSummarizeRequest is step 1 of the pipeline: body and headers. It returns
// invalid_request for anything malformed and unsupported_language for a language
// the server does not serve — those two are deliberately different codes.
//
// Origin is not checked here. The WAF on CloudFront does that, and a request with a
// foreign Origin never reaches the function at all.
func parseSummarizeRequest(r *http.Request) (summarizeRequest, errorCode) {
	parsed := summarizeRequest{country: r.Header.Get("CloudFront-Viewer-Country")}

	deviceID := r.Header.Get("X-Device-Id")
	if !uuidV4Pattern.MatchString(deviceID) {
		return parsed, errInvalidRequest
	}
	parsed.deviceID = deviceID

	catalogVersion, err := strconv.Atoi(r.Header.Get("X-Catalog-Version"))
	if err != nil || catalogVersion < 1 {
		return parsed, errInvalidRequest
	}
	parsed.catalogVersion = catalogVersion

	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	body := requestBody{}
	if err := decoder.Decode(&body); err != nil {
		return parsed, errInvalidRequest
	}
	if decoder.More() {
		return parsed, errInvalidRequest // something follows the JSON object
	}
	if body.Text == nil || body.Lang == nil || body.Ratio == nil || body.Source == nil {
		return parsed, errInvalidRequest
	}

	switch *body.Ratio {
	case "light", "normal", "tight":
	default:
		return parsed, errInvalidRequest
	}
	switch *body.Source {
	case "selection", "page", "manual":
	default:
		return parsed, errInvalidRequest
	}
	parsed.ratio = *body.Ratio
	parsed.source = *body.Source
	parsed.text = strings.TrimSpace(*body.Text)

	parsed.lang = normalizeLang(*body.Lang)
	if !cfg.languages[strings.ToLower(parsed.lang)] {
		return parsed, errUnsupportedLanguage
	}

	return parsed, ""
}

// checkLength is step 2. Length is counted in Unicode code points, never in bytes:
// on Cyrillic and CJK a byte count is two to three times higher and would reject
// text the client legitimately let through.
func checkLength(text string) errorCode {
	length := utf8.RuneCountInString(text)
	if length < cfg.minInput {
		return errTooShort
	}
	if length > cfg.maxInput {
		return errTooLong
	}
	return ""
}

// normalizeLang folds a BCP-47 tag onto the shape the whitelist uses. Portuguese and
// Chinese keep their variants because the texts genuinely differ; English, Spanish
// and French variants do not. An unknown tag is returned as its base subtag and then
// fails the whitelist check — the client-side fallback to English does not apply here,
// where an unserved language must be reported rather than silently swapped.
func normalizeLang(tag string) string {
	parts := strings.Split(strings.TrimSpace(tag), "-")
	base := strings.ToLower(parts[0])

	subtags := map[string]bool{}
	for _, part := range parts[1:] {
		subtags[strings.ToLower(part)] = true
	}

	switch base {
	case "zh":
		if subtags["hant"] || subtags["tw"] || subtags["hk"] || subtags["mo"] {
			return "zh-Hant"
		}
		return "zh-Hans"
	case "pt":
		if subtags["pt"] {
			return "pt-PT"
		}
		return "pt-BR"
	}
	return base
}
