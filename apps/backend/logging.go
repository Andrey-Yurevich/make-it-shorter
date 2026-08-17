package main

import (
	"encoding/json"
	"log"
	"os"
)

// One structured JSON record per request, written when the handler returns.
//
// No user text ever appears here: not the source, not the summary, not the follow-up
// answers, not fragments of any of them. Bedrock errors are logged without echoing the
// request they came from.

type requestLog struct {
	Event string `json:"event"`

	InputLength int    `json:"inputLength"`
	Source      string `json:"source,omitempty"`
	Lang        string `json:"lang,omitempty"`
	Ratio       string `json:"ratio,omitempty"`
	Country     string `json:"country,omitempty"`

	DocType      string   `json:"docType,omitempty"`
	SrcLang      string   `json:"srcLang,omitempty"`
	ActionIDs    []string `json:"actionIds,omitempty"`
	EmptyActions bool     `json:"emptyActions"`

	Model            string `json:"model,omitempty"`
	MaxSummaryTokens int    `json:"maxSummaryTokens,omitempty"`
	MaxAnswerTokens  int    `json:"maxAnswerTokens,omitempty"`
	MaxActions       int    `json:"maxActions,omitempty"`
	DailyQuota       int    `json:"dailyQuota,omitempty"`

	FirstTokenMs int64 `json:"firstTokenMs,omitempty"`
	TotalMs      int64 `json:"totalMs"`

	TokensIn         int     `json:"tokensIn"`
	TokensOut        int     `json:"tokensOut"`
	CacheReadTokens  int     `json:"cacheReadTokens"`
	CacheWriteTokens int     `json:"cacheWriteTokens"`
	CacheReadShare   float64 `json:"cacheReadShare"`
	EstimatedCostUsd float64 `json:"estimatedCostUsd"`

	AnswersStarted int   `json:"answersStarted"`
	AnswersFailed  int   `json:"answersFailedCount"`
	AllAnswersFail bool  `json:"answersFailed"`
	SlowestAnswer  int64 `json:"slowestAnswerMs,omitempty"`

	ErrorCode string `json:"errorCode,omitempty"`
}

func (entry *requestLog) write() {
	entry.Event = "summarize"

	// The share of input read from cache is the only thing that shows the second cache
	// breakpoint still works. A share near zero means the input is being paid for six
	// times over, and the bill would say so only days later.
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
