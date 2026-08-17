package main

import (
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime/types"
)

// The order around the second cache breakpoint is the one thing in this service that
// breaks without failing: get it wrong and everything still works, while the input is
// billed once per button instead of once per request. The bill says so days later, the
// cacheReadShare field says so immediately, and this test says so before either.
func TestCacheBreakpointsSeparateSharedFromPhaseTask(t *testing.T) {
	shared := buildSharedBlock(summarizeRequest{lang: "ru", ratio: "normal", text: "the source text"})
	blocks := userContent(t, buildMessages(shared, "phase task"))

	if len(blocks) != 3 {
		t.Fatalf("want three blocks: shared, cache point, phase task; got %d", len(blocks))
	}
	if text, ok := blocks[0].(*types.ContentBlockMemberText); !ok || text.Value != shared {
		t.Fatalf("the shared part must come first")
	}
	if _, ok := blocks[1].(*types.ContentBlockMemberCachePoint); !ok {
		t.Fatalf("the cache point must sit between the shared part and the phase task")
	}
	if text, ok := blocks[2].(*types.ContentBlockMemberText); !ok || text.Value != "phase task" {
		t.Fatalf("the phase task must come last, after the cache point")
	}
}

// Everything the two phases share — output language, compression and the user text —
// belongs before the breakpoint, and the text belongs last so nothing variable follows it.
func TestSharedBlockCarriesLanguageCompressionAndText(t *testing.T) {
	shared := buildSharedBlock(summarizeRequest{lang: "pt-BR", ratio: "tight", text: "the source text"})

	for _, want := range []string{"Output language: pt-BR", "Compression: tight", "the source text"} {
		if !strings.Contains(shared, want) {
			t.Errorf("shared block is missing %q:\n%s", want, shared)
		}
	}
	if !strings.HasSuffix(shared, "the source text") {
		t.Errorf("the user text must end the shared block:\n%s", shared)
	}
}

// Phase 2 answers from the source text, never from the summary: the summary may simply
// not contain the answer, and that is the failure class this design exists to close.
func TestAnswerTaskCarriesOnlyTheInstruction(t *testing.T) {
	task := buildAnswerTask("List the conditions the offer hides.")

	if !strings.Contains(task, "List the conditions the offer hides.") {
		t.Errorf("the catalog instruction must reach the phase 2 task:\n%s", task)
	}
	if !strings.Contains(task, "text above") {
		t.Errorf("the task must point the model at the source text, not at the summary:\n%s", task)
	}
}

func TestStaticPromptDropsToolRulesWhenTheCatalogIsEmpty(t *testing.T) {
	cfg = &config{maxActions: 5}

	empty := loadTestCatalog(t, `{"version": 1, "actions": []}`)
	if strings.Contains(buildStaticPrompt(empty), toolName) {
		t.Errorf("an empty catalog has no tool, so the prompt must not describe one")
	}

	filled := loadTestCatalog(t, `{"version": 1, "actions": [
		{"id": "whats_the_catch", "since": 1, "description": "when the text hides conditions", "instruction": "i"}]}`)
	prompt := buildStaticPrompt(filled)
	if !strings.Contains(prompt, toolName) {
		t.Errorf("the tool rules are missing from the prompt")
	}
	if !strings.Contains(prompt, "whats_the_catch — when the text hides conditions") {
		t.Errorf("the id -> description table is missing from the prompt:\n%s", prompt)
	}
}

// The button ceiling moved here from the tool schema, which cannot carry maxItems
// alongside strict. Two things have to hold: the number reaches the model at all, and
// it is the global MAX_ACTIONS rather than the value resolved for one tier or device —
// a number that varies per request sits before the first cache breakpoint and would
// give each of them its own prefix and its own cache.
func TestStaticPromptCarriesTheGlobalCeiling(t *testing.T) {
	cat := loadTestCatalog(t, `{"version": 1, "actions": [
		{"id": "whats_the_catch", "since": 1, "description": "d", "instruction": "i"}]}`)

	cfg = &config{maxActions: 5}
	prompt := buildStaticPrompt(cat)
	if !strings.Contains(prompt, "at most 5 ids") {
		t.Errorf("the ceiling is missing from the prompt:\n%s", prompt)
	}

	// A smaller ceiling resolved for a tier must leave the static prompt alone.
	cfg.rest.maxActions = 2
	if buildStaticPrompt(cat) != prompt {
		t.Errorf("the static prompt changed with a per-tier ceiling, which splits the prompt cache")
	}
}

// userContent unwraps the single user message a request is built from.
func userContent(t *testing.T, built []types.Message) []types.ContentBlock {
	t.Helper()
	if len(built) != 1 {
		t.Fatalf("want a single user message, got %d", len(built))
	}
	if built[0].Role != types.ConversationRoleUser {
		t.Fatalf("the message must come from the user role")
	}
	return built[0].Content
}
