package main

import (
	"net/http"
	"strings"
	"testing"

	"github.com/aws/aws-lambda-go/events"
)

func TestOfferedWindowsAreTheOnesTheBotRuns(t *testing.T) {
	for _, window := range offeredWindows {
		if _, err := parseWindow(window); err != nil {
			t.Errorf("the bot offers %q but parseWindow rejects it: %v", window, err)
		}
	}

	// The CLI takes any duration; the bot must not, or a chat message can name a window
	// whose Insights scan is unbounded.
	if isOfferedWindow("1000h") {
		t.Error("1000h is not one of the offered windows and must not be accepted")
	}
}

func TestSecretTokenIsRequired(t *testing.T) {
	secrets = botConfig{}
	if validSecret("") {
		t.Error("an unconfigured bot must reject every request, not accept empty ones")
	}

	secrets = botConfig{WebhookSecret: "correct"}
	if validSecret("wrong") || validSecret("") || validSecret("correct-and-more") {
		t.Error("only the exact secret may pass")
	}
	if !validSecret("correct") {
		t.Error("the exact secret must pass")
	}
}

func TestStrangersGetNothing(t *testing.T) {
	secrets = botConfig{WebhookSecret: "s", BotToken: "t"}

	// With no allow-list the bot hands back the chat id, and only that: it is the only
	// way to learn the id that goes into the allow-list.
	allowedChats = nil
	bootstrap := answer(t.Context(), 4242, "/report")
	if !strings.Contains(bootstrap, "4242") {
		t.Errorf("an unconfigured bot should report the chat id, got %q", bootstrap)
	}
	if strings.Contains(bootstrap, "Total cost") {
		t.Error("an unconfigured bot must not run a report")
	}

	// Once anyone is allowed, everyone else is met with silence.
	allowedChats = []int64{1}
	if reply := answer(t.Context(), 4242, "/report"); reply != "" {
		t.Errorf("a chat that is not allowed must get no reply, got %q", reply)
	}
}

func TestUsageForAnythingUnrecognised(t *testing.T) {
	secrets = botConfig{WebhookSecret: "s", BotToken: "t"}
	allowedChats = []int64{7}

	for _, text := range []string{"/start", "/help", "hello", "/report 1000h", ""} {
		if reply := answer(t.Context(), 7, text); !strings.Contains(reply, "/report") {
			t.Errorf("%q should be answered with the usage, got %q", text, reply)
		}
	}
}

func TestFormatReportSurvivesFailedSections(t *testing.T) {
	// Every section null: the queries behind them failed. Nothing may be printed as a
	// zero, and the problems have to show.
	text := formatReport(report{
		Window:   "24h",
		Problems: []string{"waf activity: boom"},
	}, "us-east-1", "/aws/lambda/mis-api")

	for _, want := range []string{"Total cost: <b>unavailable</b>", "WAF blocked: unavailable", "problems:", "boom"} {
		if !strings.Contains(text, want) {
			t.Errorf("the message should contain %q:\n%s", want, text)
		}
	}
}

// The webhook's guards, checked at the door rather than through answer(): these are the
// paths that must never reach a report, and none of them calls Telegram.
func TestWebhookRejectsWhatItShould(t *testing.T) {
	secrets = botConfig{WebhookSecret: "correct", BotToken: "t"}
	allowedChats = []int64{7}

	post := func(secret, body string) int {
		request := events.LambdaFunctionURLRequest{Body: body}
		request.RequestContext.HTTP.Method = http.MethodPost
		if secret != "" {
			request.Headers = map[string]string{"x-telegram-bot-api-secret-token": secret}
		}
		response, err := handleWebhook(t.Context(), request)
		if err != nil {
			t.Fatalf("the handler must not return an error to the runtime: %v", err)
		}
		return response.StatusCode
	}

	if code := post("", `{}`); code != http.StatusForbidden {
		t.Errorf("a request with no secret should be 403, got %d", code)
	}
	if code := post("wrong", `{}`); code != http.StatusForbidden {
		t.Errorf("a request with the wrong secret should be 403, got %d", code)
	}
	if code := post("correct", strings.Repeat("x", maxBodyLength+1)); code != http.StatusRequestEntityTooLarge {
		t.Errorf("an oversized body should be 413, got %d", code)
	}
	// Unparsable, but authenticated: 200, because Telegram resends anything else and the
	// second attempt would fail exactly as the first did.
	if code := post("correct", `not json`); code != http.StatusOK {
		t.Errorf("an unparsable update should be 200, got %d", code)
	}
	// Authenticated, well formed, and from a chat that is not on the list: accepted and
	// answered with nothing.
	if code := post("correct", `{"message":{"chat":{"id":999},"text":"/report"}}`); code != http.StatusOK {
		t.Errorf("a stranger's message should be 200, got %d", code)
	}

	get := events.LambdaFunctionURLRequest{}
	get.RequestContext.HTTP.Method = http.MethodGet
	response, _ := handleWebhook(t.Context(), get)
	if response.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("GET should be 405, got %d", response.StatusCode)
	}
}

// The pieces of the message that are easy to get wrong and impossible to see from a
// terminal: the flag, the zone, the bold values, and the link into CloudWatch.
func TestFormatReportRendering(t *testing.T) {
	cost := 0.1637
	rate := 0.0619
	// 2026-08-19 11:23:27 UTC, which is 13:23:27 in Berlin.
	const summer = 1787138607520

	text := formatReport(report{
		Window:       "24h",
		From:         summer,
		To:           summer + 3600_000,
		TotalCostUsd: &cost,
		TopCountries: []countryCost{{Country: "PL", CostUsd: cost}, {Country: "??", CostUsd: 0}},
		Waf:          &wafSection{Blocked: 2, TopRules: []ruleHit{{Rule: "origin-must-be-the-extension (block)", Hits: 2}}},
		Lambda:       &lambdaStats{Errors: 7, Invocations: 113, ErrorRate: &rate},
		LastLambdaErrors: []lambdaError{{
			TimestampMs: summer,
			ID:          "a2a91f05-2bbf-4813-8af1-3ee4d94b77e9",
			LogStream:   "2026/08/19/[$LATEST]bd5786f4",
			Message:     "Status: error Error Type: Runtime.ExitError",
		}},
		LastServiceErrors: []serviceError{{
			TimestampMs: summer,
			ErrorCode:   "nothing_to_shorten",
			LogStream:   "2026/08/19/[$LATEST]8061c947",
		}},
		Problems: []string{},
	}, "us-east-1", "/aws/lambda/mis-api")

	want := []string{
		"🇵🇱 PL",                 // the flag is the country code in regional indicators
		"🏳 ??",                  // and an unknown country gets a blank one, not a wrong one
		"<b>$0.1637</b>",        // values are bold, keys are not
		"14:23:27 CEST",         // the zone rides on the end of the window, in its summer name
		"$252Faws$252Flambda",   // the console's double escaping of the log group
		"$255B$2524LATEST$255D", // and of the "[$LATEST]" every Lambda stream carries
		"<code>a2a91f05-2bbf-4813-8af1-3ee4d94b77e9</code>",
	}
	for _, fragment := range want {
		if !strings.Contains(text, fragment) {
			t.Errorf("the message should contain %q", fragment)
		}
	}

	t.Log("\n" + text)
}
