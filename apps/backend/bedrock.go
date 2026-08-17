package main

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime/document"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime/types"
)

type tokenUsage struct {
	input      int
	output     int
	cacheRead  int
	cacheWrite int
}

func (u *tokenUsage) add(other tokenUsage) {
	u.input += other.input
	u.output += other.output
	u.cacheRead += other.cacheRead
	u.cacheWrite += other.cacheWrite
}

func usageFrom(used *types.TokenUsage) tokenUsage {
	if used == nil {
		return tokenUsage{}
	}
	return tokenUsage{
		input:      int(aws.ToInt32(used.InputTokens)),
		output:     int(aws.ToInt32(used.OutputTokens)),
		cacheRead:  int(aws.ToInt32(used.CacheReadInputTokens)),
		cacheWrite: int(aws.ToInt32(used.CacheWriteInputTokens)),
	}
}

type phase1Result struct {
	ids          []string // as the model returned them, before filtering
	docType      string
	srcLang      string
	usage        tokenUsage
	firstTokenAt time.Time // zero when no text ever arrived
}

// suggestActionsInput is the tool call the model makes. docType and srcLang go to the
// log only: the client is never told them and nothing in the response depends on them.
type suggestActionsInput struct {
	IDs     []string `json:"ids"`
	DocType string   `json:"docType"`
	SrcLang string   `json:"srcLang"`
}

// runPhase1 streams the summary and collects the tool call. Blocks are handled by
// type, never by order: with tool_choice auto the text block and the tool call may
// arrive in either order.
func runPhase1(ctx context.Context, params requestParams, req summarizeRequest, onDelta func(string)) (phase1Result, error) {
	result := phase1Result{}

	out, err := bedrockClient.ConverseStream(ctx, &bedrockruntime.ConverseStreamInput{
		ModelId:    aws.String(params.model),
		System:     buildSystemBlocks(),
		Messages:   buildMessages(buildSharedBlock(req), phaseTask()),
		ToolConfig: buildToolConfig(),
		InferenceConfig: &types.InferenceConfiguration{
			MaxTokens: aws.Int32(int32(params.maxSummaryTokens)),
		},
	})
	if err != nil {
		return result, err
	}

	stream := out.GetStream()
	defer stream.Close()

	toolBlockIndex := int32(-1)
	toolInput := strings.Builder{}

	for event := range stream.Events() {
		switch typed := event.(type) {
		case *types.ConverseStreamOutputMemberContentBlockStart:
			start, isToolUse := typed.Value.Start.(*types.ContentBlockStartMemberToolUse)
			if isToolUse && aws.ToString(start.Value.Name) == toolName {
				toolBlockIndex = aws.ToInt32(typed.Value.ContentBlockIndex)
			}

		case *types.ConverseStreamOutputMemberContentBlockDelta:
			switch delta := typed.Value.Delta.(type) {
			case *types.ContentBlockDeltaMemberText:
				if result.firstTokenAt.IsZero() {
					result.firstTokenAt = time.Now()
				}
				onDelta(delta.Value)
			case *types.ContentBlockDeltaMemberToolUse:
				if aws.ToInt32(typed.Value.ContentBlockIndex) == toolBlockIndex {
					toolInput.WriteString(aws.ToString(delta.Value.Input))
				}
			}

		case *types.ConverseStreamOutputMemberMetadata:
			result.usage = usageFrom(typed.Value.Usage)
		}
	}
	if err := stream.Err(); err != nil {
		return result, err
	}

	// No tool call is a valid outcome and means "nothing to clarify here". A default
	// set of buttons must never be substituted for it.
	if toolInput.Len() > 0 {
		called := suggestActionsInput{}
		if err := json.Unmarshal([]byte(toolInput.String()), &called); err == nil {
			result.ids = called.IDs
			result.docType = called.DocType
			result.srcLang = called.SrcLang
		}
	}

	return result, nil
}

// runPhase2 writes one follow-up answer. Converse, not ConverseStream: the reader is
// looking at the summary and cannot see this text at all, so it is buffered whole and
// leaves as a single answer event.
//
// tool_choice stays auto here, because the Converse API has no "none" — the tool
// config is kept identical to phase 1 anyway, since dropping it would change the
// cached prefix and cost the whole cache. A stray tool call is simply ignored.
func runPhase2(ctx context.Context, params requestParams, req summarizeRequest, instruction string) (string, tokenUsage, error) {
	out, err := bedrockClient.Converse(ctx, &bedrockruntime.ConverseInput{
		ModelId:    aws.String(params.model),
		System:     buildSystemBlocks(),
		Messages:   buildMessages(buildSharedBlock(req), buildAnswerTask(instruction)),
		ToolConfig: buildToolConfig(),
		InferenceConfig: &types.InferenceConfiguration{
			MaxTokens: aws.Int32(int32(params.maxAnswerTokens)),
		},
	})
	if err != nil {
		return "", tokenUsage{}, err
	}

	message, ok := out.Output.(*types.ConverseOutputMemberMessage)
	if !ok {
		return "", usageFrom(out.Usage), nil
	}

	answer := strings.Builder{}
	for _, block := range message.Value.Content {
		if text, isText := block.(*types.ContentBlockMemberText); isText {
			answer.WriteString(text.Value)
		}
	}
	return strings.TrimSpace(answer.String()), usageFrom(out.Usage), nil
}

func phaseTask() string {
	if len(cat.activeIDs) == 0 {
		return phase1TaskNoTool
	}
	return phase1Task
}

// buildSystemBlocks holds the first cache breakpoint: everything before it is static
// across every request the service ever serves.
func buildSystemBlocks() []types.SystemContentBlock {
	return []types.SystemContentBlock{
		&types.SystemContentBlockMemberText{Value: staticPrompt},
		&types.SystemContentBlockMemberCachePoint{Value: types.CachePointBlock{Type: types.CachePointTypeDefault}},
	}
}

// buildMessages holds the second cache breakpoint, between the shared part and the
// phase task. Phase 1 writes that cache entry, the parallel phase 2 calls read it.
func buildMessages(shared, task string) []types.Message {
	return []types.Message{{
		Role: types.ConversationRoleUser,
		Content: []types.ContentBlock{
			&types.ContentBlockMemberText{Value: shared},
			&types.ContentBlockMemberCachePoint{Value: types.CachePointBlock{Type: types.CachePointTypeDefault}},
			&types.ContentBlockMemberText{Value: task},
		},
	}}
}

// buildToolConfig returns the tool, identical byte for byte in both phases. The schema
// is static: filtering the enum by client catalog version would produce a different
// grammar per client and shatter the prompt cache. Version filtering happens after the
// answer instead.
//
// An empty catalog yields no tool at all — that is the skeleton state, before the
// catalog is filled in.
func buildToolConfig() *types.ToolConfiguration {
	if len(cat.activeIDs) == 0 {
		return nil
	}
	return &types.ToolConfiguration{
		Tools:      []types.Tool{toolDefinition},
		ToolChoice: &types.ToolChoiceMemberAuto{Value: types.AutoToolChoice{}},
	}
}

// buildToolDefinition is called once at start. strict gives constrained decoding: an
// id outside the enum cannot physically be generated. The server filters ids anyway —
// that check is insurance, this is the guarantee.
func buildToolDefinition(cat *buttonCatalog) types.Tool {
	schema := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"ids": map[string]any{
				"type": "array",
				// No maxItems, deliberately: constrained decoding rejects it outright
				// ("For 'array' type, property 'maxItems' is not supported"), and a
				// schema carrying both is refused on every single request. Of the two,
				// strict is the one worth keeping — it is what makes an id outside the
				// enum impossible to generate, where maxItems only capped the count.
				//
				// The ceiling lives in the prompt now, and the hard cut in
				// filterActionIDs still runs before phase 2, so a model that proposes
				// too many costs nothing beyond the ids that get dropped.
				"description": "Ids of the follow-up buttons to offer, best first.",
				"items": map[string]any{
					"type": "string",
					"enum": cat.activeIDs,
				},
			},
			"docType": map[string]any{
				"type":        "string",
				"description": "What kind of material this text is.",
				"enum":        []string{"news", "article", "product", "scientific", "legal", "howto", "thread", "other"},
			},
			"srcLang": map[string]any{
				"type":        "string",
				"description": "Language of the source text as a BCP-47 code.",
			},
		},
		"required":             []string{"ids", "docType", "srcLang"},
		"additionalProperties": false,
	}

	return &types.ToolMemberToolSpec{Value: types.ToolSpecification{
		Name:        aws.String(toolName),
		Description: aws.String("Propose the follow-up buttons to show under the summary. Call it at most once, and not at all when the text has nothing worth clarifying."),
		Strict:      aws.Bool(true),
		InputSchema: &types.ToolInputSchemaMemberJson{Value: document.NewLazyDocument(schema)},
	}}
}
