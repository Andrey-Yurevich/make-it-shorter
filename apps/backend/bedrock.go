package main

import (
	"context"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
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

	out, err := bedrockClient.ConverseStream(ctx, &bedrockruntime.ConverseStreamInput{
		ModelId:  aws.String(params.model),
		System:   buildSystemBlocks(),
		Messages: buildMessages(buildUserBlock(req)),
		InferenceConfig: &types.InferenceConfiguration{
			MaxTokens: aws.Int32(int32(params.maxSummaryTokens)),
		},
	})
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
