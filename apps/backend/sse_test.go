package main

import (
	"net/http/httptest"
	"strings"
	"testing"
)

// The client's parser is allowed to assume that data is always a single line, because
// JSON escapes the newlines inside strings. If that ever stops being true, every
// client breaks at once.
func TestFramesAreSingleLine(t *testing.T) {
	recorder := httptest.NewRecorder()
	stream := newSSEWriter(recorder)

	stream.sendDelta("first line\nsecond line\r\nthird")
	stream.sendAnswer("whats_the_catch", "line\nbreak")
	stream.sendActions(nil)
	stream.sendDone(10, 20)
	stream.comment("ping")

	body := recorder.Body.String()
	for _, line := range strings.Split(body, "\n") {
		if strings.HasPrefix(line, "data: ") && strings.ContainsAny(line, "\r") {
			t.Fatalf("a raw carriage return reached a data line: %q", line)
		}
	}

	want := []string{
		"event: delta\ndata: {\"text\":\"first line\\nsecond line\\r\\nthird\"}\n\n",
		"event: answer\ndata: {\"id\":\"whats_the_catch\",\"text\":\"line\\nbreak\"}\n\n",
		// An empty list must serialize as [], never null: the client tells "no buttons"
		// from a dropped connection by this event alone.
		"event: actions\ndata: {\"ids\":[]}\n\n",
		"event: done\ndata: {\"tokensIn\":10,\"tokensOut\":20}\n\n",
		": ping\n\n",
	}
	for _, frame := range want {
		if !strings.Contains(body, frame) {
			t.Errorf("missing frame:\n%q\ngot:\n%q", frame, body)
		}
	}

	if contentType := recorder.Header().Get("Content-Type"); contentType != "text/event-stream" {
		t.Errorf("Content-Type = %q, want text/event-stream", contentType)
	}
}

// Errors travel as an SSE event under HTTP 200. Only service_disabled carries a
// message; every other code takes its wording from the extension's _locales.
func TestErrorFrames(t *testing.T) {
	recorder := httptest.NewRecorder()
	stream := newSSEWriter(recorder)
	stream.sendError(errServiceDisabled, "Back on Monday.")
	stream.sendError(errTooLong, "")

	if recorder.Code != 200 {
		t.Errorf("status = %d, want 200", recorder.Code)
	}
	body := recorder.Body.String()
	if !strings.Contains(body, `event: error`+"\n"+`data: {"code":"service_disabled","message":"Back on Monday."}`) {
		t.Errorf("service_disabled frame missing its message: %q", body)
	}
	if !strings.Contains(body, `data: {"code":"too_long"}`) {
		t.Errorf("too_long should carry no message: %q", body)
	}
}
