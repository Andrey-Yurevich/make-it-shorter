package main

import (
	"encoding/json"
	"fmt"
	"net/http"
)

// The SSE side of the protocol. One frame is
//
//	event: <name>\ndata: <compact JSON on one line>\n\n
//
// Multi-line data never happens: json.Marshal escapes newlines inside strings, and
// the client's parser is allowed to rely on that.
//
// Every error is answered with HTTP 200 and a single `error` event. A non-200 status
// means transport trouble to the client, and a rejected request is not that.

type errorCode string

const (
	errTooShort            errorCode = "too_short"
	errTooLong             errorCode = "too_long"
	errRateLimited         errorCode = "rate_limited"
	errUnsupportedLanguage errorCode = "unsupported_language"
	errUpstreamError       errorCode = "upstream_error"
	errInvalidRequest      errorCode = "invalid_request"
	errServiceDisabled     errorCode = "service_disabled"
)

type sseWriter struct {
	writer  http.ResponseWriter
	flusher http.Flusher // nil under Lambda, where writes go straight into the response pipe
}

func newSSEWriter(w http.ResponseWriter) *sseWriter {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)

	stream := &sseWriter{writer: w}
	if flusher, ok := w.(http.Flusher); ok {
		stream.flusher = flusher
	}
	return stream
}

// send writes one frame. A write error means the client is gone; there is nothing to
// do about it and nothing to report to, so it is dropped here and the pipeline keeps
// running to its end.
func (s *sseWriter) send(event string, payload any) {
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	fmt.Fprintf(s.writer, "event: %s\ndata: %s\n\n", event, data)
	s.flush()
}

func (s *sseWriter) flush() {
	if s.flusher != nil {
		s.flusher.Flush()
	}
}

func (s *sseWriter) sendDelta(text string) {
	s.send("delta", map[string]string{"text": text})
}

func (s *sseWriter) sendDone(tokensIn, tokensOut int) {
	s.send("done", map[string]int{"tokensIn": tokensIn, "tokensOut": tokensOut})
}

// sendError replaces done. The message is only ever set for service_disabled: it is
// hand-written English shown as is. Every other code carries no text, because the
// wording for it lives in the extension.
func (s *sseWriter) sendError(code errorCode, message string) {
	payload := map[string]string{"code": string(code)}
	if message != "" {
		payload["message"] = message
	}
	s.send("error", payload)
}
