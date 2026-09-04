package main

import (
	"context"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
)

// The Telegram side of the same binary: a webhook handler that answers five commands by
// running the report this program already knows how to build.
//
// Webhook and not long polling, because long polling needs a process that is always
// running, and this one exists for a few seconds a day.
//
// The endpoint is a Lambda Function URL with no IAM auth, because Telegram signs nothing
// and can only be told a URL. What keeps strangers out is three things in a row, checked
// in this order:
//
//  1. The secret token. Telegram sends the value given to setWebhook in a header on
//     every call, and a request without it never gets past the first check. This is the
//     door.
//  2. The chat allow-list. Bots are discoverable by username, so anyone can open a chat
//     and type; the allow-list is what makes those messages go nowhere.
//  3. Reserved concurrency on the function, set in Terraform, so a flood costs a bounded
//     amount rather than an unbounded one.
//
// The URL itself is unguessable, but that is a side effect and not a control: it appears
// in Telegram's settings and in anything that ever logs it.

type botConfig struct {
	BotToken      string `json:"botToken"`
	WebhookSecret string `json:"webhookSecret"`
}

var (
	secrets        botConfig
	allowedChats   []int64
	apiLogGroup    string
	wafLogGroup    string
	apiFunction    string
	secretsManager *secretsmanager.Client
)

// runLambda is the entry point when the binary runs inside Lambda. Everything it needs
// is read once here, at cold start, and not on every update.
func runLambda() {
	ctx := context.Background()

	awsConfig, err := config.LoadDefaultConfig(ctx, config.WithRegion(os.Getenv("AWS_REGION")))
	if err != nil {
		log.Fatalf("could not load AWS configuration: %v", err)
	}
	newClients(awsConfig)
	secretsManager = secretsmanager.NewFromConfig(awsConfig)

	apiLogGroup = os.Getenv("API_LOG_GROUP")
	wafLogGroup = os.Getenv("WAF_LOG_GROUP")
	apiFunction = os.Getenv("API_FUNCTION_NAME")

	for _, chat := range strings.Split(os.Getenv("ALLOWED_CHAT_IDS"), ",") {
		chat = strings.TrimSpace(chat)
		if chat == "" {
			continue
		}
		id, err := strconv.ParseInt(chat, 10, 64)
		if err != nil {
			log.Fatalf("ALLOWED_CHAT_IDS holds something that is not a chat id: %q", chat)
		}
		allowedChats = append(allowedChats, id)
	}

	if err := loadSecrets(ctx); err != nil {
		// Fatal on purpose: a bot that cannot read its token can do nothing at all, and
		// failing at cold start says so once, loudly, instead of once per message.
		log.Fatalf("could not read the bot secret: %v", err)
	}

	lambda.Start(handleWebhook)
}

func loadSecrets(ctx context.Context) error {
	out, err := secretsManager.GetSecretValue(ctx, &secretsmanager.GetSecretValueInput{
		SecretId: aws.String(os.Getenv("SECRET_ID")),
	})
	if err != nil {
		return err
	}
	if err := json.Unmarshal([]byte(aws.ToString(out.SecretString)), &secrets); err != nil {
		return fmt.Errorf("the secret is not the expected JSON: %w", err)
	}
	if secrets.BotToken == "" || secrets.WebhookSecret == "" {
		return fmt.Errorf("the secret is missing botToken or webhookSecret")
	}
	return nil
}

// The largest update worth reading. Telegram updates are small; a body past this is not
// one, and reading it would only spend memory on someone else's idea.
const maxBodyLength = 64 * 1024

func handleWebhook(ctx context.Context, request events.LambdaFunctionURLRequest) (events.LambdaFunctionURLResponse, error) {
	if request.RequestContext.HTTP.Method != http.MethodPost {
		return status(http.StatusMethodNotAllowed), nil
	}

	// Function URL headers arrive lower-cased.
	if !validSecret(request.Headers["x-telegram-bot-api-secret-token"]) {
		// No detail, in the answer or in the log: a stranger learns nothing about why,
		// and the log stays a count of knocks rather than a record of who knocked.
		log.Printf("rejected a request with a bad or missing secret token")
		return status(http.StatusForbidden), nil
	}

	body := request.Body
	if request.IsBase64Encoded {
		decoded, err := base64.StdEncoding.DecodeString(body)
		if err != nil {
			return status(http.StatusBadRequest), nil
		}
		body = string(decoded)
	}
	if len(body) > maxBodyLength {
		return status(http.StatusRequestEntityTooLarge), nil
	}

	received := update{}
	if err := json.Unmarshal([]byte(body), &received); err != nil {
		log.Printf("could not parse the update: %v", err)
		// 200 on purpose. Telegram resends anything it does not get a 200 for, and an
		// update this bot cannot parse will not parse the second time either.
		return status(http.StatusOK), nil
	}

	chatID := received.Message.Chat.ID
	if chatID == 0 {
		return status(http.StatusOK), nil
	}

	reply := answer(ctx, chatID, received.Message.Text)
	if reply != "" {
		if err := sendMessage(ctx, secrets.BotToken, chatID, reply); err != nil {
			log.Printf("could not send the reply: %v", err)
		}
	}
	return status(http.StatusOK), nil
}

// answer decides what to say back, or says nothing at all. Returning "" is how a message
// from a stranger ends: no reply, no error, no hint that anything is here.
func answer(ctx context.Context, chatID int64, text string) string {
	if !allowed(chatID) {
		// The one exception, and it exists to solve a chicken and egg: the allow-list is
		// a list of chat ids, and there is no way to learn your own chat id without the
		// bot telling you. So while the list is empty, and only then, the bot answers
		// with the id and nothing else. Once a single id is configured, this is silence.
		if len(allowedChats) == 0 {
			return fmt.Sprintf("This bot has no allowed chats configured.\nThis chat is %d — put it in telegram_chat_ids and apply.", chatID)
		}
		log.Printf("ignored a message from a chat that is not allowed")
		return ""
	}

	command, argument, _ := strings.Cut(strings.TrimSpace(text), " ")
	command, _, _ = strings.Cut(command, "@") // "/report@my_bot" in a group
	argument = strings.TrimSpace(argument)

	switch command {
	case "/report":
		if argument == "" {
			argument = "24h"
		}
		return buildAndFormat(ctx, argument)
	case "/start", "/help", "":
		return usage()
	default:
		// A bare window, so "/report 1h" and "1h" both work.
		if isOfferedWindow(command) {
			return buildAndFormat(ctx, command)
		}
		return usage()
	}
}

func buildAndFormat(ctx context.Context, window string) string {
	if !isOfferedWindow(window) {
		return usage()
	}

	span, err := parseWindow(window)
	if err != nil {
		return usage()
	}

	end := time.Now().UTC()
	built := buildReport(ctx, apiLogGroup, wafLogGroup, apiFunction, window, end.Add(-span), end)

	// The region and the API log group go to the formatter so it can turn each error's
	// timestamp into a link to the log stream it came from.
	return formatReport(built, os.Getenv("AWS_REGION"), apiLogGroup)
}

// The five windows the bot offers, and the only ones it will run.
//
// The CLI takes any duration Go can parse, because a person at a terminal deciding to
// ask about 90 minutes is answering to themselves. The bot does not: an Insights query
// is billed by the bytes it scans, and an unbounded window arriving as a chat message is
// an unbounded bill arriving as a chat message.
var offeredWindows = []string{"30m", "1h", "12h", "24h", "month"}

func isOfferedWindow(window string) bool {
	for _, offered := range offeredWindows {
		if window == offered {
			return true
		}
	}
	return false
}

func usage() string {
	return "make it shorter — reports\n\n/report 30m\n/report 1h\n/report 12h\n/report 24h\n/report month\n\n/report on its own is the last 24h."
}

func allowed(chatID int64) bool {
	for _, id := range allowedChats {
		if id == chatID {
			return true
		}
	}
	return false
}

// validSecret compares in constant time. A byte-by-byte comparison that returns early
// leaks the secret's prefix to anyone willing to measure, and the check is cheap enough
// that there is no reason to take the risk.
func validSecret(given string) bool {
	if secrets.WebhookSecret == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(given), []byte(secrets.WebhookSecret)) == 1
}

func status(code int) events.LambdaFunctionURLResponse {
	return events.LambdaFunctionURLResponse{StatusCode: code}
}
