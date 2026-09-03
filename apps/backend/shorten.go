package main

import (
	"context"
	"log"
	"net/http"
	"time"
	"unicode/utf8"
)

// POST /v1/shorten — the whole product, in the order the pipeline runs it:
//
//  0. service switch
//  1. body and headers
//  2. length
//  3. quota
//  4. the shorter text, streamed out as delta events
//  5. done
//
// Steps 0-3 happen before Bedrock is touched. A failure at any of them is an SSE
// response carrying a single error event, with HTTP 200 underneath: a rejected request
// is not a transport failure and must not look like one.
//
// The request is stateless. The text lives in this function's memory while the answer
// is being written and disappears with it.
func handleShorten(w http.ResponseWriter, r *http.Request) {
	startedAt := time.Now()
	entry := requestLog{}
	answered := false
	defer func() {
		entry.TotalMs = time.Since(startedAt).Milliseconds()
		entry.write()
		// Tokens spent on a request that failed halfway are still spent, so the cost
		// metric is published on both paths.
		publishMetrics(entry.EstimatedCostUsd, answered)
	}()

	ctx := r.Context()
	stream := newSSEWriter(w)

	fail := func(code errorCode, message string) {
		entry.ErrorCode = string(code)
		stream.sendError(code, message)
	}

	// Step 0. The kill switch, first of all: a disabled service spends neither a
	// GetItem nor a quota increment. The client learns about it on its very next
	// request, because there is no config cache anywhere to go stale.
	if !cfg.serviceEnabled {
		fail(errServiceDisabled, cfg.disabledMessage)
		return
	}

	// Step 1. Body and headers.
	req, code := parseShortenRequest(r)
	// Recorded before the check, so that an unsupported_language says which language was
	// asked for — that is the only thing that can tell us which one to add next.
	entry.Country = req.country
	entry.Source = req.source
	entry.Lang = req.lang
	entry.Tone = req.tone
	if code != "" {
		fail(code, "")
		return
	}

	// Step 2. Length, in Unicode code points. This repeats the client's own check on
	// purpose: the client check only saves a request, and the server is the single
	// authority.
	entry.InputLength = utf8.RuneCountInString(req.text)
	if code := checkLength(req.text); code != "" {
		fail(code, "")
		return
	}

	// Step 3. Per-device overrides, the parameters resolved from them, and the quota.
	override, err := fetchDeviceOverride(ctx, req.deviceID)
	if err != nil {
		// Overrides are the exception, not the rule, so a read failure here means the
		// request runs on tier and default values rather than not running at all. A
		// real DynamoDB outage still stops the request one call later, at the quota.
		log.Printf("could not read device override: %v", err)
	}

	params := resolveParams(override, req.country)
	entry.Model = params.model
	entry.MaxSummaryTokens = params.maxSummaryTokens
	entry.DailyQuota = params.dailyQuota

	withinQuota, err := chargeQuota(ctx, req.deviceID, params.dailyQuota)
	if err != nil {
		log.Printf("could not charge quota: %v", err)
		fail(errUpstreamError, "")
		return
	}
	if !withinQuota {
		fail(errRateLimited, "")
		return
	}

	// Step 4. The shorter text streams out as delta events while it is written.
	modelCtx, cancelModelCall := modelCallContext(ctx)
	defer cancelModelCall()

	shortened, err := runShorten(modelCtx, params, req, stream.sendDelta)
	recordUsage(&entry, params.model, shortened.usage)
	if err != nil {
		// Logged without echoing any part of the request.
		log.Printf("bedrock failed: %v", err)
		fail(errUpstreamError, "")
		return
	}
	if !shortened.firstTokenAt.IsZero() {
		entry.FirstTokenMs = shortened.firstTokenAt.Sub(startedAt).Milliseconds()
	}

	// The model's own verdict, not the server's: the input was not a text. Nothing has
	// been forwarded, so the error event is the whole answer. The quota was spent and
	// stays spent — the model was asked and did its job.
	if shortened.nothingToShorten {
		entry.NothingToShorten = true
		fail(errNothingToShorten, "")
		return
	}

	// Step 5. Done, which always goes out on the normal path: without it the client
	// cannot tell a finished answer from a dropped connection.
	stream.sendDone(shortened.usage.input+shortened.usage.cacheRead+shortened.usage.cacheWrite, shortened.usage.output)
	answered = true
}

func recordUsage(entry *requestLog, model string, usage tokenUsage) {
	entry.TokensIn = usage.input
	entry.TokensOut = usage.output
	entry.CacheReadTokens = usage.cacheRead
	entry.CacheWriteTokens = usage.cacheWrite
	entry.EstimatedCostUsd = estimateCostUsd(model, usage)
}

// What is left of the invocation after the model stops: writing done, or the error
// event when the call ran out of time. Without the margin a hung call takes the
// invocation down with the connection still open, and the client is told nothing at
// all instead of upstream_error.
const timeToFinishResponse = 2 * time.Second

// modelCallContext bounds the model call so that margin survives.
func modelCallContext(ctx context.Context) (context.Context, context.CancelFunc) {
	deadline, ok := ctx.Deadline()
	if !ok {
		return context.WithCancel(ctx) // no invocation deadline, so a local run
	}

	remaining := time.Until(deadline) - timeToFinishResponse
	if remaining <= 0 {
		return context.WithCancel(ctx) // nothing left to reserve; let the call try anyway
	}
	return context.WithTimeout(ctx, remaining)
}
