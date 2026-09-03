package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Steps 0 to 2 run before anything is called: no DynamoDB, no Bedrock. This test walks
// the pipeline as far as it goes without them and checks that a rejected request still
// looks like a served one — HTTP 200 with a single error event, and no delta before it.
func TestPipelineRejectsBeforeCallingAnything(t *testing.T) {
	const deviceID = "3f1a6b2c-9d4e-4a1b-8c2d-5e6f7a8b9c0d"

	cases := []struct {
		name    string
		enabled bool
		message string
		body    string
		want    string
	}{
		{
			name:    "the kill switch answers first, with its message",
			enabled: false,
			message: "Back on Monday.",
			body:    `{"text":"long enough to pass the length check","lang":"ru","tone":"original","source":"page"}`,
			want:    `{"code":"service_disabled","message":"Back on Monday."}`,
		},
		{
			name:    "a broken body is invalid_request, not a user error",
			enabled: true,
			body:    `{"text":"long enough to pass the length check","lang":"ru","tone":"shouting","source":"page"}`,
			want:    `{"code":"invalid_request"}`,
		},
		{
			name:    "a language the server does not serve gets its own code",
			enabled: true,
			body:    `{"text":"long enough to pass the length check","lang":"is","tone":"original","source":"page"}`,
			want:    `{"code":"unsupported_language"}`,
		},
		{
			name:    "short text never reaches the model",
			enabled: true,
			body:    `{"text":"tiny","lang":"ru","tone":"original","source":"page"}`,
			want:    `{"code":"too_short"}`,
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			cfg = &config{
				serviceEnabled:  testCase.enabled,
				disabledMessage: testCase.message,
				minInput:        10,
				maxInput:        100,
				languages:       map[string]bool{"ru": true},
			}

			request := httptest.NewRequest(http.MethodPost, "/v1/shorten", strings.NewReader(testCase.body))
			request.Header.Set("X-Device-Id", deviceID)
			recorder := httptest.NewRecorder()

			handleShorten(recorder, request)

			if recorder.Code != http.StatusOK {
				t.Errorf("status = %d, want 200: a rejected request is not a transport failure", recorder.Code)
			}
			body := recorder.Body.String()
			if !strings.Contains(body, "event: error\ndata: "+testCase.want) {
				t.Errorf("got:\n%q\nwant an error frame with %s", body, testCase.want)
			}
			if strings.Contains(body, "event: delta") || strings.Contains(body, "event: done") {
				t.Errorf("nothing but the error may be sent on this path:\n%q", body)
			}
		})
	}
}

// An unknown path is a plain 404 and carries no SSE at all.
func TestUnknownPathIs404(t *testing.T) {
	recorder := httptest.NewRecorder()
	route(recorder, httptest.NewRequest(http.MethodPost, "/v1/whatever", strings.NewReader("{}")))

	if recorder.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", recorder.Code)
	}
	if strings.Contains(recorder.Body.String(), "event:") {
		t.Errorf("a 404 must not be dressed up as SSE: %q", recorder.Body.String())
	}
}

// GET does not exist in this API: the Origin rule on the WAF holds without path
// exceptions precisely because every endpoint is POST.
func TestGetIsNotRouted(t *testing.T) {
	recorder := httptest.NewRecorder()
	route(recorder, httptest.NewRequest(http.MethodGet, "/v1/shorten", nil))

	if recorder.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", recorder.Code)
	}
}

// The model call has to give the invocation back a moment before it dies, or a hung
// call ends as a truncated stream instead of an error event.
func TestSummaryLeavesRoomToFinishTheResponse(t *testing.T) {
	ctx, cancelInvocation := context.WithTimeout(context.Background(), 50*time.Second)
	defer cancelInvocation()

	summaryCtx, cancel := summaryContext(ctx)
	defer cancel()

	deadline, ok := summaryCtx.Deadline()
	if !ok {
		t.Fatal("the call must be bounded when the invocation has a deadline")
	}
	if left := time.Until(deadline); left < 47*time.Second || left > 48*time.Second {
		t.Errorf("the call got %v, want about 48s: 50 minus the 2s to write done", left)
	}
}

// Locally there is no invocation deadline and nothing to divide.
func TestSummaryIsUnboundedWithoutAnInvocationDeadline(t *testing.T) {
	summaryCtx, cancel := summaryContext(context.Background())
	defer cancel()

	if _, ok := summaryCtx.Deadline(); ok {
		t.Error("the call should not invent a deadline that the invocation does not have")
	}
}
