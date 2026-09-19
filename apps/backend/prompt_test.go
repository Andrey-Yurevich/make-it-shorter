package main

import (
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime/types"
)

// The static part of the prompt has to stay on the system side of the cache
// breakpoint, and the request's own text on the other side of it. Get that wrong and
// nothing fails visibly: the prefix stops being identical between requests and the
// cache, once the prompt is long enough to have one, quietly never hits.
func TestSystemBlocksEndAtTheCacheBreakpoint(t *testing.T) {
	blocks := buildSystemBlocks()

	if len(blocks) != 2 {
		t.Fatalf("want the static prompt and the cache point; got %d blocks", len(blocks))
	}
	if text, ok := blocks[0].(*types.SystemContentBlockMemberText); !ok || text.Value != shortenPrompt {
		t.Fatalf("the static prompt must come first")
	}
	if _, ok := blocks[1].(*types.SystemContentBlockMemberCachePoint); !ok {
		t.Fatalf("the cache point must close the static part")
	}
}

// Everything variable — output language, tone, the user text and the task — travels in
// one user block, after the breakpoint.
func TestUserBlockCarriesLanguageToneTextAndTask(t *testing.T) {
	block := buildUserBlock(shortenRequest{lang: "pt", tone: "professional", text: "the source text"})

	for _, want := range []string{"Output language: Portuguese (pt)", "Tone: professional", "the source text"} {
		if !strings.Contains(block, want) {
			t.Errorf("user block is missing %q:\n%s", want, block)
		}
	}
	// The task goes last so that nothing but the instruction about the text follows
	// the text itself.
	if !strings.HasSuffix(block, shortenTask) {
		t.Errorf("the task must end the user block:\n%s", block)
	}
	if strings.Index(block, "the source text") > strings.Index(block, shortenTask) {
		t.Errorf("the text must come before the task:\n%s", block)
	}
}

// Every tone the parser lets through has to be explained to the model: a value the
// prompt says nothing about would be guessed at, and the guess would differ per request.
func TestPromptDescribesEveryKnownTone(t *testing.T) {
	for tone := range knownTones {
		if !strings.Contains(shortenPrompt, "\n- "+tone+" — ") {
			t.Errorf("the prompt has no line for tone %q", tone)
		}
	}
}

// The shapes the prompt tells the model to recognise and mirror. The extension writes
// light Markdown for them — bold lines, "- ", "| cell |" — but pasted text carries none,
// so the prompt has to name each shape and how it looks either way; the shape rules are
// what stops a list or a table from coming back as a paragraph.
func TestPromptDescribesEveryShape(t *testing.T) {
	for _, shape := range []string{"Prose", "A list", "A table", "A document with sections", "Mixed"} {
		if !strings.Contains(shortenPrompt, "\n- "+shape+" — ") {
			t.Errorf("the prompt has no line for shape %q", shape)
		}
	}
}

// The 57 codes the extension offers. Every one of them needs an English name, because
// that name — not the code — is what the prompt says. The user block has to carry both,
// name first, so that "be" reads as Belarusian and not as a verb.
func TestLanguageNamesCoverEveryOfferedLanguage(t *testing.T) {
	offered := []string{
		"af", "sq", "ar", "hy", "az", "bn", "be", "bg", "zh", "hr", "cs", "da", "nl", "en", "et",
		"tl", "fi", "fr", "ka", "de", "el", "gu", "he", "hi", "hu", "id", "it", "ja", "kk", "ko",
		"lv", "lt", "mk", "ms", "ml", "mr", "nb", "fa", "pl", "pt", "pa", "ro", "ru", "sr", "sk",
		"sl", "es", "sw", "sv", "ta", "te", "th", "tr", "uk", "ur", "uz", "vi",
	}
	if len(offered) != 57 {
		t.Fatalf("the test list has %d codes, want 57", len(offered))
	}
	if len(languageNames) != len(offered) {
		t.Errorf("languageNames has %d entries, the extension offers %d", len(languageNames), len(offered))
	}
	for _, code := range offered {
		if languageNames[code] == "" {
			t.Errorf("no English name for %q", code)
		}
		if normalizeLang(code) != code {
			t.Errorf("%q is not stable under normalizeLang: an offered code must pass through unchanged", code)
		}
	}

	block := buildUserBlock(shortenRequest{lang: "be", tone: "direct", text: "the source text"})
	if !strings.Contains(block, "Output language: Belarusian (be)") {
		t.Errorf("the user block must name the language, got:\n%s", block)
	}
}

// The system prompt has to tell the model to start in the output language: the user
// block names it, but a first word in the source language is a whole answer in it.
func TestPromptTellsTheModelToBeginInTheOutputLanguage(t *testing.T) {
	if !strings.Contains(shortenPrompt, "Begin in the output language from the first word.") {
		t.Errorf("the prompt does not say to begin in the output language")
	}
}

// The sentinel the stream is checked against has to be the one the model is told to
// write. Change either alone and every "nothing to shorten" goes out as text.
func TestPromptTellsTheModelTheSentinel(t *testing.T) {
	if !strings.Contains(shortenPrompt, nothingToShortenSentinel) {
		t.Errorf("the prompt never mentions %q", nothingToShortenSentinel)
	}
}

// The hold-back at the start of the stream: forwarded once the sentinel is ruled out,
// swallowed once it is found, and undecided for as long as what has arrived could still
// turn into it.
func TestCheckSentinel(t *testing.T) {
	cases := []struct {
		written string
		want    sentinelVerdict
	}{
		{"", sentinelUndecided},
		{"\n", sentinelUndecided},
		{"[[", sentinelUndecided},
		{"[[NOTHING_TO", sentinelUndecided},
		{"\n\n[[NOTHING_TO_SHORTEN]]", sentinelFound},
		{"[[NOTHING_TO_SHORTEN]] because this is a search page", sentinelFound},
		{"[", sentinelUndecided},
		{"[a", sentinelAbsent},
		{"Do not go gentle", sentinelAbsent},
		{"Не уходи", sentinelAbsent},
	}
	for _, testCase := range cases {
		if got := checkSentinel(testCase.written); got != testCase.want {
			t.Errorf("checkSentinel(%q) = %v, want %v", testCase.written, got, testCase.want)
		}
	}
}

func TestRequestIsASingleUserMessage(t *testing.T) {
	built := buildMessages("the user block")

	if len(built) != 1 {
		t.Fatalf("want a single user message, got %d", len(built))
	}
	if built[0].Role != types.ConversationRoleUser {
		t.Fatalf("the message must come from the user role")
	}
	if len(built[0].Content) != 1 {
		t.Fatalf("want one content block, got %d", len(built[0].Content))
	}
	if text, ok := built[0].Content[0].(*types.ContentBlockMemberText); !ok || text.Value != "the user block" {
		t.Fatalf("the user block must be the whole of the message")
	}
}
