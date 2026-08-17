package main

import (
	"context"
	"log"
	"net/http"
	"time"
	"unicode/utf8"
)

// POST /v1/summarize — the whole product, in the order the spec lists it:
//
//  0. service switch
//  1. body and headers
//  2. length
//  3. quota
//  4. phase 1: summary + suggest_actions
//  5. deltas, then the filtered ids
//  6. phase 2: one call per surviving id, in parallel
//  7. done
//
// Steps 0-3 happen before Bedrock is touched. A failure at any of them is an SSE
// response carrying a single error event, with HTTP 200 underneath: a rejected request
// is not a transport failure and must not look like one.
//
// The request is stateless. The text lives in this function's memory while the answer
// is being written and disappears with it.
func handleSummarize(w http.ResponseWriter, r *http.Request) {
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
	req, code := parseSummarizeRequest(r)
	// Recorded before the check, so that an unsupported_language says which language was
	// asked for — that is the only thing that can tell us which one to add next.
	entry.Country = req.country
	entry.Source = req.source
	entry.Lang = req.lang
	entry.Ratio = req.ratio
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
	entry.MaxAnswerTokens = params.maxAnswerTokens
	entry.MaxActions = params.maxActions
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

	// Step 4 and 5. Phase 1: the summary streams out as delta events while it is
	// written, and the tool call arrives in one piece at the end of the stream.
	phase1Ctx, cancelPhase1 := phaseOneContext(ctx)
	defer cancelPhase1()

	phase1, err := runPhase1(phase1Ctx, params, req, stream.sendDelta)
	usage := phase1.usage
	recordUsage(&entry, params.model, usage)
	if err != nil {
		// Logged without echoing any part of the request.
		log.Printf("bedrock phase 1 failed: %v", err)
		fail(errUpstreamError, "")
		return
	}
	entry.DocType = phase1.docType
	entry.SrcLang = phase1.srcLang
	if !phase1.firstTokenAt.IsZero() {
		entry.FirstTokenMs = phase1.firstTokenAt.Sub(startedAt).Milliseconds()
	}

	ids := filterActionIDs(cat, phase1.ids, req.catalogVersion, params.maxActions)
	entry.ActionIDs = ids
	entry.EmptyActions = len(ids) == 0

	// Sent before phase 2 begins, not after it: the buttons appear under the summary
	// straight away, inactive for a moment, instead of materializing out of nowhere
	// several seconds later.
	stream.sendActions(ids)

	// Step 6. Phase 2: one call per surviving id, all at once. Five calls in sequence
	// would not fit the timeout; five in parallel take about as long as one.
	if len(ids) > 0 {
		usage.add(writeAnswers(ctx, stream, &entry, params, req, ids))
	}

	// Step 7. Done — the client's reconciliation point. Any id from actions that never
	// got its answer is dropped there, and its button disappears.
	recordUsage(&entry, params.model, usage)
	stream.sendDone(usage.input+usage.cacheRead+usage.cacheWrite, usage.output)
	answered = true
}

func recordUsage(entry *requestLog, model string, usage tokenUsage) {
	entry.TokensIn = usage.input
	entry.TokensOut = usage.output
	entry.CacheReadTokens = usage.cacheRead
	entry.CacheWriteTokens = usage.cacheWrite
	entry.EstimatedCostUsd = estimateCostUsd(model, usage)
}

// phaseOneContext bounds phase 1 so that phase 2 keeps its whole window and done still
// gets written before the invocation dies. The spec budgets phase 1 at about 20 seconds,
// phase 2 at 25 and the function at 50; without a bound here that budget holds by luck
// alone, and a single hung summary costs the reader the follow-ups and the done event
// along with it.
//
// With the values of the spec that leaves phase 1 about 23 seconds.
func phaseOneContext(ctx context.Context) (context.Context, context.CancelFunc) {
	deadline, ok := ctx.Deadline()
	if !ok {
		return context.WithCancel(ctx) // no invocation deadline, so a local run
	}

	remaining := time.Until(deadline)
	forPhase1 := remaining - cfg.answerTimeout - timeToWriteAnswers
	if forPhase1 <= 0 {
		// ANSWER_TIMEOUT_SECONDS is set at or above the function timeout, which is a
		// misconfiguration. Splitting what is left keeps the service answering instead
		// of failing every request the moment it starts.
		forPhase1 = remaining / 2
	}
	return context.WithTimeout(ctx, forPhase1)
}

// What phase 2 needs after its slowest call returns: writing the answers and done.
const timeToWriteAnswers = 2 * time.Second

type answerResult struct {
	id    string
	text  string
	usage tokenUsage
	took  time.Duration
	err   error
}

// writeAnswers runs phase 2 and sends every answer that arrives, in whatever order the
// calls come back — the client sorts them by id, not by arrival.
//
// A call that fails or runs out of time simply produces no answer event: no retry, no
// error code, no failing of the whole response. The summary has already been
// delivered, and losing it over one follow-up out of five would be the worst trade
// available.
func writeAnswers(ctx context.Context, stream *sseWriter, entry *requestLog, params requestParams, req summarizeRequest, ids []string) tokenUsage {
	results := make(chan answerResult, len(ids))
	for _, id := range ids {
		go func(id string) {
			// Phase 2 has a deadline of its own, well below the function's: one hung
			// call out of five must not hold up done and the other four.
			callCtx, cancel := context.WithTimeout(ctx, cfg.answerTimeout)
			defer cancel()

			calledAt := time.Now()
			text, used, err := runPhase2(callCtx, params, req, cat.byID[id].Instruction)
			results <- answerResult{id: id, text: text, usage: used, took: time.Since(calledAt), err: err}
		}(id)
	}
	entry.AnswersStarted = len(ids)

	// The one stretch of the response where the connection may legitimately stay
	// silent for up to 25 seconds. Intermediate proxies close connections like that,
	// so a comment line goes out every 10 seconds; clients ignore it by the standard.
	heartbeat := time.NewTicker(10 * time.Second)
	defer heartbeat.Stop()

	usage := tokenUsage{}
	for pending := len(ids); pending > 0; {
		select {
		case result := <-results:
			pending--
			usage.add(result.usage)
			if result.took.Milliseconds() > entry.SlowestAnswer {
				entry.SlowestAnswer = result.took.Milliseconds()
			}
			if result.err != nil || result.text == "" {
				if result.err != nil {
					log.Printf("bedrock phase 2 failed for %s: %v", result.id, result.err)
				}
				entry.AnswersFailed++
				continue
			}
			stream.sendAnswer(result.id, result.text)

		case <-heartbeat.C:
			stream.comment("ping")
		}
	}

	// Every follow-up failing is not an error either — the reader gets the summary
	// without buttons. It is logged on its own field because a steady share of it means
	// phase 2 is broken, not that the catalog picks badly.
	entry.AllAnswersFail = entry.AnswersFailed == entry.AnswersStarted
	return usage
}
