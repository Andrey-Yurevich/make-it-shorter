package main

import (
	"context"
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

type summaryResult struct {
	usage        tokenUsage
	firstTokenAt time.Time // zero when no text ever arrived
}

// runSummary streams the summary, handing every piece of text to onDelta as it
// arrives. It is the only model call the service makes.
func runSummary(ctx context.Context, params requestParams, req shortenRequest, onDelta func(string)) (summaryResult, error) {
	result := summaryResult{}

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

	for event := range stream.Events() {
		switch typed := event.(type) {
		case *types.ConverseStreamOutputMemberContentBlockDelta:
			if delta, isText := typed.Value.Delta.(*types.ContentBlockDeltaMemberText); isText {
				if result.firstTokenAt.IsZero() {
					result.firstTokenAt = time.Now()
				}
				onDelta(delta.Value)
			}

		case *types.ConverseStreamOutputMemberMetadata:
			result.usage = usageFrom(typed.Value.Usage)
		}
	}
	if err := stream.Err(); err != nil {
		return result, err
	}

	return result, nil
}

// buildSystemBlocks holds the cache breakpoint: everything before it is static across
// every request the service ever serves.
func buildSystemBlocks() []types.SystemContentBlock {
	return []types.SystemContentBlock{
		&types.SystemContentBlockMemberText{Value: summaryPrompt},
		&types.SystemContentBlockMemberCachePoint{Value: types.CachePointBlock{Type: types.CachePointTypeDefault}},
	}
}

func buildMessages(userBlock string) []types.Message {
	return []types.Message{{
		Role:    types.ConversationRoleUser,
		Content: []types.ContentBlock{&types.ContentBlockMemberText{Value: userBlock}},
	}}
}
