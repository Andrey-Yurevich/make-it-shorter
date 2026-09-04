package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Telegram, over the two calls this bot makes: reading the update it was handed, and
// sending one message back.
//
// No client library. The Bot API is JSON over HTTPS, the bot speaks two of its methods,
// and a dependency here would be more code to audit than the code it replaces — the
// project's rule is that every dependency past the standard library and the AWS SDK has
// to earn its place, and this one cannot.

// update is the slice of Telegram's Update this bot reads. Everything else in the
// object — and there is a great deal of it — is ignored by omission.
type update struct {
	Message struct {
		Text string `json:"text"`
		Chat struct {
			ID int64 `json:"id"`
		} `json:"chat"`
	} `json:"message"`
}

// sendMessage posts one message to a chat.
//
// Errors are returned rather than retried. A retry would risk sending the report twice,
// and a report that failed to arrive is something the person will notice and ask for
// again — cheaper than a duplicate they cannot tell from a second incident.
func sendMessage(ctx context.Context, botToken string, chatID int64, text string) error {
	payload, err := json.Marshal(map[string]any{
		"chat_id": chatID,
		"text":    text,
		// HTML and not Markdown. The report carries rule names, error text and log ids,
		// any of which can hold an underscore or an asterisk; Markdown reads those as
		// formatting and Telegram rejects the whole message when they fail to pair. HTML
		// needs three characters escaped, and formatReport escapes every value it did not
		// write itself.
		"parse_mode":               "HTML",
		"disable_web_page_preview": true,
	})
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	// The token is a credential and it lives in the URL, which is where the Bot API puts
	// it. Nothing here logs the URL.
	request, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://api.telegram.org/bot"+botToken+"/sendMessage", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		// The body carries Telegram's own description of what was wrong with the call.
		// It is the bot's own message coming back, so there is nothing of the user's in it.
		return fmt.Errorf("telegram answered %s", response.Status)
	}
	return nil
}

// The longest message Telegram accepts is 4096 characters. A report is far shorter, but
// an error list on a bad day is not bounded by anything this code controls.
const maxMessageLength = 4000

func truncateForTelegram(text string) string {
	runes := []rune(text)
	if len(runes) <= maxMessageLength {
		return text
	}
	return string(runes[:maxMessageLength]) + "\n…truncated"
}
