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
	block := buildUserBlock(shortenRequest{lang: "pt-BR", tone: "formal", text: "the source text"})

	for _, want := range []string{"Output language: pt-BR", "Tone: formal", "the source text"} {
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
