package main

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatchlogs"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatchlogs/types"
)

// The three questions asked of CloudWatch Logs Insights, and the machinery for asking
// them. Everything here reads the API function's log group; nothing writes to it.

// costRow is one line of a leaderboard: a key and the dollars behind it.
type costRow struct {
	key  string
	cost float64
}

// logLine is one line of an error list: when it happened, something to find the record
// by, and something to read. A bare identifier says a thing went wrong without saying
// what, and without a time there is no telling whether it is news.
type logLine struct {
	timestampMs int64
	// The Lambda request id, empty on the lines that arrive without one.
	id string
	// The full log stream name, kept whole because a CloudWatch console link is built
	// from it and a shortened one addresses nothing.
	stream string
	text   string
}

// costByCountry returns every country seen in the window, most expensive first.
//
// The whole list rather than the top five, because the caller needs both the leaderboard
// and the total, and one query that returns everything is cheaper than two queries — an
// Insights query is billed by the bytes it scans, and both would scan the same bytes.
func costByCountry(ctx context.Context, logGroup string, start, end time.Time) ([]costRow, error) {
	const query = `
		filter event = "shorten"
		| stats sum(estimatedCostUsd) as cost by country
		| sort cost desc`

	results, err := runQuery(ctx, logGroup, query, start, end)
	if err != nil {
		return nil, err
	}

	rows := []costRow{}
	for _, result := range results {
		// A record written before the country header was read has no country field at
		// all, and Insights returns the group with the field missing rather than empty.
		country := result["country"]
		if country == "" {
			country = "??"
		}
		cost, _ := strconv.ParseFloat(result["cost"], 64)
		rows = append(rows, costRow{key: country, cost: cost})
	}
	return rows, nil
}

// lastLambdaErrors returns the most recent lines the function wrote outside its own
// structured record: the runtime's own failures, and the log.Printf calls the handler
// makes when something it could not control went wrong.
//
// The first filter drops the per-request JSON records, which are the bulk of the group
// and which carry their own error field — those are the next query's business. What is
// left is text, and the second filter picks the alarming ones out of it.
func lastLambdaErrors(ctx context.Context, logGroup string, start, end time.Time) ([]logLine, error) {
	// INIT_REPORT is dropped because a failed init also produces a REPORT for the
	// invocation it took down, saying the same thing and saying it with a request id.
	// Keeping both would spend two of the five lines on one incident.
	const query = `
		fields toMillis(@timestamp) as timestampMs, @requestId, @logStream, @message
		| filter @message not like /"event":"shorten"/
		| filter @message not like /^INIT_REPORT/
		| filter @message like /(?i)(error|exception|panic|timed out|failed|could not)/
		| sort @timestamp desc
		| limit 5`

	results, err := runQuery(ctx, logGroup, query, start, end)
	if err != nil {
		return nil, err
	}

	lines := []logLine{}
	for _, result := range results {
		lines = append(lines, logLine{
			timestampMs: epochMillis(result["timestampMs"]),
			id:          result["@requestId"],
			stream:      result["@logStream"],
			text:        firstLine(trimReportPreamble(result["@message"])),
		})
	}
	return lines, nil
}

// lastServiceErrors returns the most recent requests that ended in an error event
// instead of done, by the code the client was given.
//
// Every code is included, not just the upstream ones: rate_limited and too_long are
// answers about the service as much as upstream_error is, and a report that hid them
// would make a quota problem look like silence.
func lastServiceErrors(ctx context.Context, logGroup string, start, end time.Time) ([]logLine, error) {
	const query = `
		fields toMillis(@timestamp) as timestampMs, @requestId, @logStream, errorCode
		| filter event = "shorten" and ispresent(errorCode)
		| sort @timestamp desc
		| limit 5`

	results, err := runQuery(ctx, logGroup, query, start, end)
	if err != nil {
		return nil, err
	}

	lines := []logLine{}
	for _, result := range results {
		lines = append(lines, logLine{
			timestampMs: epochMillis(result["timestampMs"]),
			id:          result["@requestId"],
			stream:      result["@logStream"],
			text:        result["errorCode"],
		})
	}
	return lines, nil
}

// epochMillis reads what toMillis returned.
//
// Parsed as a float and not as an integer, because Insights returns every number as a
// string and returns large ones in scientific notation: a millisecond epoch arrives as
// "1.788436989319E12". ParseInt rejects that, and the timestamps silently came out zero
// until this was a ParseFloat. A float64 holds a millisecond epoch exactly — 2^53
// milliseconds runs to the year 287396 — so nothing is lost on the way through.
//
// An unparsable value becomes zero rather than sinking the whole section.
func epochMillis(value string) int64 {
	milliseconds, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return 0
	}
	return int64(milliseconds)
}

// trimReportPreamble cuts a REPORT line down to the part that says something went
// wrong. The runtime writes the outcome of every invocation as one line of durations
// and memory figures with the verdict at the end; in a list of failures the figures are
// noise, and in a chat message they are noise that wraps.
func trimReportPreamble(message string) string {
	if !strings.HasPrefix(message, "REPORT ") {
		return message
	}
	if index := strings.Index(message, "Status:"); index >= 0 {
		return message[index:]
	}
	return message
}

// firstLine keeps an error readable in a one-line list: a Go panic brings its whole
// stack with it, and the first line is the part that says what happened.
func firstLine(message string) string {
	// Tabs are how the runtime separates the fields of a REPORT line. They survive a
	// terminal and do not survive a chat message, where they collapse or wrap.
	message = strings.ReplaceAll(message, "\t", " ")

	line, _, _ := strings.Cut(strings.TrimSpace(message), "\n")
	const maxLineLength = 160
	if len(line) > maxLineLength {
		return line[:maxLineLength] + "…"
	}
	return line
}

// How long to wait for one query before giving up on that section. Insights usually
// answers in a few seconds; a query still running after this is one that will not
// finish in time to be worth reading either.
const queryTimeout = 60 * time.Second

// runQuery runs one Insights query and returns its rows as maps of field name to value.
//
// Insights is asynchronous: the query is started, and then polled until it stops being
// Running. There is no callback and no long poll, so the loop below is the whole API.
func runQuery(ctx context.Context, logGroup, query string, start, end time.Time) ([]map[string]string, error) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()

	started, err := logsClient.StartQuery(ctx, &cloudwatchlogs.StartQueryInput{
		LogGroupName: aws.String(logGroup),
		QueryString:  aws.String(query),
		// Insights takes its bounds in whole seconds, and inclusively.
		StartTime: aws.Int64(start.Unix()),
		EndTime:   aws.Int64(end.Unix()),
	})
	if err != nil {
		return nil, fmt.Errorf("could not start query: %w", err)
	}

	for {
		out, err := logsClient.GetQueryResults(ctx, &cloudwatchlogs.GetQueryResultsInput{
			QueryId: started.QueryId,
		})
		if err != nil {
			return nil, fmt.Errorf("could not read query results: %w", err)
		}

		switch out.Status {
		case types.QueryStatusComplete:
			results := []map[string]string{}
			for _, row := range out.Results {
				result := map[string]string{}
				for _, field := range row {
					result[aws.ToString(field.Field)] = aws.ToString(field.Value)
				}
				results = append(results, result)
			}
			return results, nil

		case types.QueryStatusScheduled, types.QueryStatusRunning:
			select {
			case <-ctx.Done():
				return nil, fmt.Errorf("query did not finish within %s", queryTimeout)
			case <-time.After(time.Second):
			}

		default:
			return nil, fmt.Errorf("query ended as %s", out.Status)
		}
	}
}

// wafActivity is what the WebACL stopped or counted in the window: how many requests it
// blocked, and which rules did the work.
type wafActivity struct {
	blocked  int
	topRules []ruleHits
}

type ruleHits struct {
	rule string
	hits int
}

// wafActivity reads the WebACL's own log group.
//
// Only blocked and counted requests are written there — the logging filter in the cdn
// module drops the rest — so this is not a sample of traffic and must not be read as one.
// A quiet report here means nothing was stopped, not that nothing arrived.
func readWafActivity(ctx context.Context, wafLogGroup string, start, end time.Time) (wafActivity, error) {
	// terminatingRuleId is the rule that decided the request. For the WebACL's own rules
	// that is their name; for a managed group it is the group, not the rule inside it —
	// good enough to say "the common rule set is blocking things" and to send someone to
	// the console, which is what this line is for.
	const query = `
		stats count(*) as hits by terminatingRuleId, action
		| sort hits desc`

	results, err := runQuery(ctx, wafLogGroup, query, start, end)
	if err != nil {
		return wafActivity{}, err
	}

	activity := wafActivity{topRules: []ruleHits{}}
	for _, result := range results {
		hits, _ := strconv.Atoi(result["hits"])

		if result["action"] == "BLOCK" {
			activity.blocked += hits
		}

		// Blocked and counted hits of one rule are two rows and become two lines, because
		// they are two different things: one turned a user away, the other only watched.
		rule := result["terminatingRuleId"]
		if rule == "" {
			rule = "??"
		}
		activity.topRules = append(activity.topRules, ruleHits{
			rule: rule + " (" + strings.ToLower(result["action"]) + ")",
			hits: hits,
		})
	}
	return activity, nil
}
