package main

import (
	"encoding/json"
	"log"
	"os"
)

// One structured JSON record per request, written when the handler returns.
//
// No user text ever appears here: not the source and not the shorter text, nor
// fragments of either. Bedrock errors are logged without echoing the request they came from.

type requestLog struct {
	Event string `json:"event"`

	InputLength int    `json:"inputLength"`
	Source      string `json:"source,omitempty"`
	Lang        string `json:"lang,omitempty"`
	Tone        string `json:"tone,omitempty"`
	Country     string `json:"country,omitempty"`

	Model            string `json:"model,omitempty"`
	MaxSummaryTokens int    `json:"maxSummaryTokens,omitempty"`
	DailyQuota       int    `json:"dailyQuota,omitempty"`

	FirstTokenMs int64 `json:"firstTokenMs,omitempty"`
	TotalMs      int64 `json:"totalMs"`

	TokensIn         int     `json:"tokensIn"`
	TokensOut        int     `json:"tokensOut"`
	CacheReadTokens  int     `json:"cacheReadTokens"`
	CacheWriteTokens int     `json:"cacheWriteTokens"`
	CacheReadShare   float64 `json:"cacheReadShare"`
	EstimatedCostUsd float64 `json:"estimatedCostUsd"`

	// The model judged the input not to be a text. Kept apart from ErrorCode, which also
	// says nothing_to_shorten, because this is the one "error" that is the model's call
	// and not the server's: a rising share here means the prompt, not the pipeline.
	NothingToShorten bool `json:"nothingToShorten,omitempty"`

	ErrorCode string `json:"errorCode,omitempty"`
}

func (entry *requestLog) write() {
	// The metric filter behind the daily cost alarm selects on this value. Renaming it
	// without renaming the filter zeroes the alarm silently.
	entry.Event = "shorten"

	// The share of input read from cache. It is zero today — the static part of the
	// prompt is below the length Bedrock will cache — and this is the field that will
	// say so the moment that stops being true.
	total := entry.TokensIn + entry.CacheReadTokens
	if total > 0 {
		entry.CacheReadShare = float64(entry.CacheReadTokens) / float64(total)
	}

	line, err := json.Marshal(entry)
	if err != nil {
		log.Printf("could not marshal request log: %v", err)
		return
	}
	os.Stdout.Write(append(line, '\n'))
}
