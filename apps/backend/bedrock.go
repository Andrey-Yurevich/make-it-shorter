package main

import (
	"context"
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

type shortenResult struct {
	usage        tokenUsage
	firstTokenAt time.Time // zero when no text ever arrived
	// The model wrote the sentinel instead of a text: the input was not something that
	// could be made shorter. No delta has been forwarded when this is set.
	nothingToShorten bool
}

// runShorten streams the shorter text, handing every piece of it to onDelta as it
// arrives. It is the only model call the service makes.
//
// The first characters are held back rather than forwarded: until they are long enough
// to compare with the sentinel, there is no telling whether this is a text or the
// model's "nothing to shorten". The hold lasts a token or two and costs nothing the
// user can see — the first chunks arrive together anyway.
func runShorten(ctx context.Context, params requestParams, req shortenRequest, onDelta func(string)) (shortenResult, error) {
	result := shortenResult{}

	input := &bedrockruntime.ConverseStreamInput{
		ModelId:  aws.String(params.model),
		System:   buildSystemBlocks(),
		Messages: buildMessages(buildUserBlock(req)),
		InferenceConfig: &types.InferenceConfiguration{
			MaxTokens: aws.Int32(int32(params.maxSummaryTokens)),
		},
	}
	if takesTemperature(params.model) {
		// Anthropic's default is 1.0, which is a lot for a tool that should give the same
		// text the same answer twice. Lower is steadier on borderline texts as well: fewer
		// refusals, fewer runs that drop half the content.
		input.InferenceConfig.Temperature = aws.Float32(0.3)
	} else {
		// The current generation thinks before it answers unless told not to. An editing
		// tool has nothing to reason about out loud, thinking tokens are billed as output,
		// and the user would wait for them before the first word.
		input.AdditionalModelRequestFields = document.NewLazyDocument(map[string]any{
			"thinking": map[string]any{"type": "disabled"},
		})
	}

	out, err := bedrockClient.ConverseStream(ctx, input)
	if err != nil {
		return result, err
	}

	stream := out.GetStream()
	defer stream.Close()

	held := strings.Builder{} // the text not yet forwarded, while the sentinel is undecided
	verdict := sentinelUndecided

	for event := range stream.Events() {
		switch typed := event.(type) {
		case *types.ConverseStreamOutputMemberContentBlockDelta:
			delta, isText := typed.Value.Delta.(*types.ContentBlockDeltaMemberText)
			if !isText {
				continue
			}
			if result.firstTokenAt.IsZero() {
				result.firstTokenAt = time.Now()
			}

			switch verdict {
			case sentinelAbsent:
				onDelta(delta.Value)
			case sentinelFound:
				// Whatever follows the sentinel is noise. The stream is drained rather
				// than abandoned so that the usage at its end is still recorded.
			case sentinelUndecided:
				held.WriteString(delta.Value)
				verdict = checkSentinel(held.String())
				if verdict == sentinelAbsent {
					onDelta(held.String())
				}
			}

		case *types.ConverseStreamOutputMemberMetadata:
			result.usage = usageFrom(typed.Value.Usage)
		}
	}
	if err := stream.Err(); err != nil {
		return result, err
	}

	switch verdict {
	case sentinelFound:
		result.nothingToShorten = true
	case sentinelUndecided:
		// The output ended while still a prefix of the sentinel: nothing at all, or a
		// stray bracket or two. Too little to call it the sentinel, so it goes out as text.
		if held.Len() > 0 {
			onDelta(held.String())
		}
	}

	return result, nil
}

// takesTemperature tells the two generations of Claude apart, because the request differs
// between them in two fields. The earlier one — Haiku 4.5, which the tiers ran until
// 2026-09 and which a device override can still name — takes a temperature and does not
// think. Claude 5 (Sonnet 5 is what the tiers run now) rejects temperature with a 400 and
// thinks by default, so it gets thinking switched off instead. The list names the earlier
// models this service has run or may be pointed back at; anything else is current.
func takesTemperature(model string) bool {
	for _, earlier := range []string{"claude-haiku-4-5", "claude-sonnet-4-6", "claude-sonnet-4-5"} {
		if strings.Contains(model, earlier) {
			return true
		}
	}
	return false
}

// buildSystemBlocks holds the cache breakpoint: everything before it is static across
// every request the service ever serves.
func buildSystemBlocks() []types.SystemContentBlock {
	return []types.SystemContentBlock{
		&types.SystemContentBlockMemberText{Value: shortenPrompt},
		&types.SystemContentBlockMemberCachePoint{Value: types.CachePointBlock{Type: types.CachePointTypeDefault}},
	}
}

func buildMessages(userBlock string) []types.Message {
	return []types.Message{{
		Role:    types.ConversationRoleUser,
		Content: []types.ContentBlock{&types.ContentBlockMemberText{Value: userBlock}},
	}}
}
