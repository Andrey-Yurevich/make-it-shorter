package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatch"
	cwtypes "github.com/aws/aws-sdk-go-v2/service/cloudwatch/types"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// The third way into the same binary: the alerter. EventBridge runs it once a minute, it
// measures six things about the API, and whatever crossed its line goes to every allowed
// Telegram chat as one message.
//
//  1. invocations of the API function in any 1, 5 or 15 minutes, against three limits
//  2. what today has cost so far, against the daily budget — the bot's own cost query
//  3. any device past its own daily call limit, read from the quota counters
//  4. error lines in the API function's log — the bot's own "last lambda errors" query
//  5. p95 time to first token over the last 15 minutes
//  6. 5xx answers from the API distribution, which serves nothing but POST /v1/shorten
//
// Every alert carries a key, and a key that fired is held in DynamoDB for a while, so a
// condition that lasts is said once per hold rather than once a minute. The hold is a
// conditional put: two runs that overlap cannot both send the same alert.

// How far back the minute-by-minute checks look. Longer than the widest window, because
// Lambda and CloudFront metrics land a minute or two late and a spike that arrives late
// should still be seen whole.
const lookback = 20 * time.Minute

// The window the first-token percentile is taken over, and the fewest answers it is
// worth taking over. Below that the 95th percentile is just the slowest answer, and one
// slow answer is exactly what a percentile is there to look past.
const (
	firstTokenWindow = 15 * time.Minute
	firstTokenSample = 5
)

type invocationLimit struct {
	minutes int
	limit   int
}

type alertSettings struct {
	apiFunction    string
	apiLogGroup    string
	tableName      string
	distributionID string

	invocationLimits []invocationLimit
	dailyBudgetUsd   float64
	deviceDailyCalls int
	firstTokenP95Ms  int
}

// loadAlertSettings reads the environment Terraform sets. Every value is required, and a
// missing or unreadable one is fatal at start, the same rule the API function follows:
// an alerter quietly running on a limit of zero would be a smoke detector with no battery.
func loadAlertSettings() (alertSettings, error) {
	problems := []string{}

	text := func(name string) string {
		value := strings.TrimSpace(os.Getenv(name))
		if value == "" {
			problems = append(problems, name+" is not set")
		}
		return value
	}
	whole := func(name string) int {
		value, err := strconv.Atoi(text(name))
		if err != nil || value <= 0 {
			problems = append(problems, name+" is not a positive whole number")
		}
		return value
	}

	settings := alertSettings{
		apiFunction:    text("API_FUNCTION_NAME"),
		apiLogGroup:    text("API_LOG_GROUP"),
		tableName:      text("TABLE_NAME"),
		distributionID: text("DISTRIBUTION_ID"),
		invocationLimits: []invocationLimit{
			{minutes: 1, limit: whole("INVOCATIONS_1M")},
			{minutes: 5, limit: whole("INVOCATIONS_5M")},
			{minutes: 15, limit: whole("INVOCATIONS_15M")},
		},
		deviceDailyCalls: whole("DEVICE_DAILY_CALLS"),
		firstTokenP95Ms:  whole("FIRST_TOKEN_P95_MS"),
	}

	budget, err := strconv.ParseFloat(text("DAILY_BUDGET_USD"), 64)
	if err != nil || budget <= 0 {
		problems = append(problems, "DAILY_BUDGET_USD is not a positive number")
	}
	settings.dailyBudgetUsd = budget

	if len(problems) > 0 {
		return alertSettings{}, errors.New(strings.Join(problems, "; "))
	}
	return settings, nil
}

// alert is one thing worth telling someone about.
type alert struct {
	// What the hold is stored under, without the alert# prefix every hold key carries.
	key string
	// How long the same key stays quiet after it fired.
	holdFor time.Duration
	// HTML for Telegram; every value this code did not write itself is escaped.
	text string
}

// alertRun is what one run measured, written to the alerter's own log as one JSON line.
// That line is the proof that the alerter is alive and reading real numbers: an alerter
// that has gone blind looks exactly like a quiet night from the chat.
//
// No device id in here: the log is for counts, the ids go only to the chat that has to
// act on them.
type alertRun struct {
	Event               string   `json:"event"`
	BusiestInvocations  []int    `json:"busiestInvocations"`
	CostTodayUsd        *float64 `json:"costTodayUsd"`
	DevicesOverLimit    *int     `json:"devicesOverLimit"`
	ErrorLines          *int     `json:"errorLines"`
	FirstTokenP95Ms     *float64 `json:"firstTokenP95Ms"`
	FirstTokenRequests  *int     `json:"firstTokenRequests"`
	DistributionRequest *int     `json:"distributionRequests"`
	Responses5xx        *int     `json:"responses5xx"`
	Fired               []string `json:"fired"`
	Problems            []string `json:"problems"`
}

// checkAlerts runs the six checks in order and returns every alert whose condition holds
// right now, held or not — holding is the caller's business.
//
// A check that fails is not skipped silently: it becomes an alert of its own, held for an
// hour, because a check that cannot run is a check that will not fire when it should.
func checkAlerts(ctx context.Context, settings alertSettings, now time.Time) ([]alert, alertRun) {
	run := alertRun{Event: "alerts", Fired: []string{}, Problems: []string{}}
	alerts := []alert{}

	failed := func(check string, err error) {
		run.Problems = append(run.Problems, check+": "+err.Error())
		alerts = append(alerts, alert{
			key:     "check-failed#" + check,
			holdFor: time.Hour,
			text:    fmt.Sprintf("⚠️ <b>Alert check failed</b>: %s\n%s", escape(check), escape(firstLine(err.Error()))),
		})
	}

	// Checks 1 and 6. One metrics call for both: the Lambda counter and the distribution's
	// two, minute by minute over the lookback.
	series, err := readAlertMetrics(ctx, settings, now.Add(-lookback), now)
	if err != nil {
		failed("metrics", err)
	} else {
		run.BusiestInvocations = []int{}
		for _, limit := range settings.invocationLimits {
			busiest := int(busiestWindow(series["invocations"], time.Duration(limit.minutes)*time.Minute))
			run.BusiestInvocations = append(run.BusiestInvocations, busiest)
			if busiest > limit.limit {
				alerts = append(alerts, alert{
					key:     fmt.Sprintf("invocations-%dm", limit.minutes),
					holdFor: lookback,
					text:    fmt.Sprintf("📈 <b>Invocations</b>: %s in %d min (limit %d)", bold(strconv.Itoa(busiest)), limit.minutes, limit.limit),
				})
			}
		}

		requests := int(sumValues(series["requests"]))
		errors5xx := count5xx(series["requests"], series["rate5xx"])
		run.DistributionRequest = &requests
		run.Responses5xx = &errors5xx
		if errors5xx > 0 {
			alerts = append(alerts, alert{
				key:     "5xx",
				holdFor: lookback,
				text:    fmt.Sprintf("🔥 <b>5xx on POST /v1/shorten</b>: %s of %d requests in the last %d min", bold(strconv.Itoa(errors5xx)), requests, int(lookback.Minutes())),
			})
		}
	}

	// Check 2. Today's spend, by the same query the bot's report sums — so the alert and
	// "/report 24h" read one number the same way. Today is the quota's day, local midnight
	// in Berlin, not the last 24 hours.
	day := now.In(reportLocation).Format("2006-01-02")
	countries, err := costByCountry(ctx, settings.apiLogGroup, startOfDay(now), now)
	if err != nil {
		failed("budget", err)
	} else {
		spent := 0.0
		for _, row := range countries {
			spent += row.cost
		}
		run.CostTodayUsd = &spent
		if spent >= settings.dailyBudgetUsd {
			alerts = append(alerts, alert{
				key:     "budget#" + day,
				holdFor: 48 * time.Hour,
				text:    fmt.Sprintf("💸 <b>Daily budget spent</b>: %s since midnight (budget %s)", bold(money(&spent)), money(&settings.dailyBudgetUsd)),
			})
		}
	}

	// Check 3. Devices past their own limit today, from the quota counters themselves.
	devices, err := devicesOverLimit(ctx, settings.tableName, day, settings.deviceDailyCalls)
	if err != nil {
		failed("devices", err)
	} else {
		over := len(devices)
		run.DevicesOverLimit = &over
		for _, device := range devices {
			alerts = append(alerts, alert{
				key:     "device#" + device.id + "#" + day,
				holdFor: 48 * time.Hour,
				text:    fmt.Sprintf("📱 <b>Device over %d calls today</b>: %s\n<code>%s</code>", settings.deviceDailyCalls, bold(strconv.Itoa(device.calls)), escape(device.id)),
			})
		}
	}

	// Check 4. Error lines in the API's log, by the bot's own query: the runtime's crashes
	// and time-outs, and every failure the handler logs itself — "bedrock failed" among
	// them, which Lambda's Errors metric never counts.
	lines, err := lastLambdaErrors(ctx, settings.apiLogGroup, now.Add(-lookback), now)
	if err != nil {
		failed("lambda errors", err)
	} else {
		found := len(lines)
		run.ErrorLines = &found
		if found > 0 {
			text := &strings.Builder{}
			fmt.Fprintf(text, "❗ <b>Lambda errors</b> in the last %d min:", int(lookback.Minutes()))
			for _, line := range lines {
				fmt.Fprintf(text, "\n%s — %s", logLink(os.Getenv("AWS_REGION"), settings.apiLogGroup, line.stream, line.timestampMs), escape(line.text))
			}
			alerts = append(alerts, alert{key: "lambda-errors", holdFor: lookback, text: text.String()})
		}
	}

	// Check 5. The 95th percentile of time to first token. A single slow answer is not an
	// incident; most of a quarter-hour being slow is.
	p95, answered, err := firstTokenP95(ctx, settings.apiLogGroup, now.Add(-firstTokenWindow), now)
	if err != nil {
		failed("first token", err)
	} else {
		run.FirstTokenP95Ms = &p95
		run.FirstTokenRequests = &answered
		if answered >= firstTokenSample && p95 > float64(settings.firstTokenP95Ms) {
			alerts = append(alerts, alert{
				key:     "first-token",
				holdFor: firstTokenWindow,
				text: fmt.Sprintf("🐢 <b>First token p95</b>: %s over %d min, %d %s (limit %s)",
					bold(seconds(p95)), int(firstTokenWindow.Minutes()), answered, plural(answered, "request"), seconds(float64(settings.firstTokenP95Ms))),
			})
		}
	}

	return alerts, run
}

// readAlertMetrics returns three minute-by-minute series: invocations of the API
// function, requests to the API distribution, and the share of those that were 5xx.
//
// CloudFront publishes its metrics in us-east-1 only, under Region=Global, which is why
// the alerter lives in us-east-1 with the rest. A dimension spelled wrong does not fail:
// it returns an empty series, which reads as a quiet minute. The run log carries the
// request count next to the 5xx count for exactly that reason — requests stuck at zero
// while the API is being used means this query is looking at nothing.
func readAlertMetrics(ctx context.Context, settings alertSettings, start, end time.Time) (map[string]map[time.Time]float64, error) {
	distribution := []cwtypes.Dimension{
		{Name: aws.String("DistributionId"), Value: aws.String(settings.distributionID)},
		{Name: aws.String("Region"), Value: aws.String("Global")},
	}
	function := []cwtypes.Dimension{
		{Name: aws.String("FunctionName"), Value: aws.String(settings.apiFunction)},
	}

	out, err := metricsClient.GetMetricData(ctx, &cloudwatch.GetMetricDataInput{
		StartTime: aws.Time(start),
		EndTime:   aws.Time(end),
		MetricDataQueries: []cwtypes.MetricDataQuery{
			minuteStat("invocations", "AWS/Lambda", "Invocations", "Sum", function),
			minuteStat("requests", "AWS/CloudFront", "Requests", "Sum", distribution),
			minuteStat("rate5xx", "AWS/CloudFront", "5xxErrorRate", "Average", distribution),
		},
	})
	if err != nil {
		return nil, fmt.Errorf("could not read metrics: %w", err)
	}

	series := map[string]map[time.Time]float64{"invocations": {}, "requests": {}, "rate5xx": {}}
	for _, result := range out.MetricDataResults {
		points := series[aws.ToString(result.Id)]
		for i, timestamp := range result.Timestamps {
			points[timestamp] = result.Values[i]
		}
	}
	return series, nil
}

func minuteStat(id, namespace, metricName, stat string, dimensions []cwtypes.Dimension) cwtypes.MetricDataQuery {
	return cwtypes.MetricDataQuery{
		Id: aws.String(id),
		MetricStat: &cwtypes.MetricStat{
			Metric: &cwtypes.Metric{
				Namespace:  aws.String(namespace),
				MetricName: aws.String(metricName),
				Dimensions: dimensions,
			},
			Period: aws.Int32(60),
			Stat:   aws.String(stat),
		},
	}
}

// busiestWindow returns the largest sum of any run of minutes as wide as width, taken
// from the minute datapoints given. Every window starts at a datapoint, which is where a
// busiest window always can start: moving its start back to an empty minute adds nothing.
func busiestWindow(points map[time.Time]float64, width time.Duration) float64 {
	busiest := 0.0
	for start := range points {
		sum := 0.0
		for timestamp, value := range points {
			if !timestamp.Before(start) && timestamp.Before(start.Add(width)) {
				sum += value
			}
		}
		if sum > busiest {
			busiest = sum
		}
	}
	return busiest
}

func sumValues(points map[time.Time]float64) float64 {
	sum := 0.0
	for _, value := range points {
		sum += value
	}
	return sum
}

// count5xx turns CloudFront's 5xx share, a percentage per minute, back into a count of
// responses: the share times that minute's requests. Rounded per minute, and up — a 5xx
// that happened is one alert's worth whatever the arithmetic says.
func count5xx(requests, rate map[time.Time]float64) int {
	total := 0
	for timestamp, share := range rate {
		if share <= 0 {
			continue
		}
		answered := requests[timestamp] * share / 100
		whole := int(answered)
		if float64(whole) < answered {
			whole++
		}
		total += whole
	}
	return total
}

// startOfDay is local midnight in Berlin, the zone the quota counters roll over in.
func startOfDay(now time.Time) time.Time {
	year, month, day := now.In(reportLocation).Date()
	return time.Date(year, month, day, 0, 0, 0, 0, reportLocation)
}

type deviceCalls struct {
	id    string
	calls int
}

// devicesOverLimit scans the quota counters for today's that are past the limit.
//
// A scan of the whole table, filtered. The table holds a counter per device per day,
// kept for two days, and a handful of hand-made overrides; reading it once a minute costs
// fractions of a cent, and an index for this would be one more thing to keep in step with
// the API function's writes.
func devicesOverLimit(ctx context.Context, table, day string, limit int) ([]deviceCalls, error) {
	paginator := dynamodb.NewScanPaginator(dynamoClient, &dynamodb.ScanInput{
		TableName:            aws.String(table),
		FilterExpression:     aws.String("begins_with(pk, :quota) AND #count > :limit"),
		ProjectionExpression: aws.String("pk, #count"),
		ExpressionAttributeNames: map[string]string{
			"#count": "count", // reserved word in DynamoDB
		},
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":quota": &ddbtypes.AttributeValueMemberS{Value: "quota#"},
			":limit": &ddbtypes.AttributeValueMemberN{Value: strconv.Itoa(limit)},
		},
	})

	devices := []deviceCalls{}
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("could not scan the quota counters: %w", err)
		}
		for _, item := range page.Items {
			key, _ := item["pk"].(*ddbtypes.AttributeValueMemberS)
			count, _ := item["count"].(*ddbtypes.AttributeValueMemberN)
			if key == nil || count == nil {
				continue
			}
			id, counterDay, ok := parseQuotaKey(key.Value)
			if !ok || counterDay != day {
				continue
			}
			calls, _ := strconv.Atoi(count.Value)
			devices = append(devices, deviceCalls{id: id, calls: calls})
		}
	}

	// Busiest first, so a long list in the chat starts with the one that matters.
	sort.Slice(devices, func(i, j int) bool { return devices[i].calls > devices[j].calls })
	return devices, nil
}

// parseQuotaKey reads quota#<deviceId>#<YYYY-MM-DD>, the key the API function writes.
func parseQuotaKey(key string) (id, day string, ok bool) {
	rest, found := strings.CutPrefix(key, "quota#")
	if !found {
		return "", "", false
	}
	cut := strings.LastIndex(rest, "#")
	if cut <= 0 || cut == len(rest)-1 {
		return "", "", false
	}
	return rest[:cut], rest[cut+1:], true
}

// firstTokenP95 returns the 95th percentile of firstTokenMs over the window, and how many
// answers it was taken over. Requests that never reached a first token — rejected before
// the model, or failed upstream — carry no value and are not part of the percentile.
func firstTokenP95(ctx context.Context, logGroup string, start, end time.Time) (float64, int, error) {
	const query = `
		filter event = "shorten" and firstTokenMs > 0
		| stats pct(firstTokenMs, 95) as p95, count(*) as answered`

	results, err := runQuery(ctx, logGroup, query, start, end)
	if err != nil {
		return 0, 0, err
	}
	// An empty window comes back either as no rows or as one row of empty values,
	// depending on Insights' mood; both are zero answers.
	if len(results) == 0 {
		return 0, 0, nil
	}
	p95, _ := strconv.ParseFloat(results[0]["p95"], 64)
	answered, _ := strconv.Atoi(results[0]["answered"])
	return p95, answered, nil
}

// holdAlert claims an alert's key for its hold, and reports whether this run is the one
// that gets to send it. A key whose hold has run out is claimed again even if DynamoDB has
// not got round to deleting it yet — TTL deletion lags by up to days.
func holdAlert(ctx context.Context, table string, fired alert, now time.Time) (bool, error) {
	_, err := dynamoClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(table),
		Item: map[string]ddbtypes.AttributeValue{
			"pk":  &ddbtypes.AttributeValueMemberS{Value: "alert#" + fired.key},
			"ttl": &ddbtypes.AttributeValueMemberN{Value: strconv.FormatInt(now.Add(fired.holdFor).Unix(), 10)},
		},
		ConditionExpression:      aws.String("attribute_not_exists(pk) OR #ttl < :now"),
		ExpressionAttributeNames: map[string]string{"#ttl": "ttl"},
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":now": &ddbtypes.AttributeValueMemberN{Value: strconv.FormatInt(now.Unix(), 10)},
		},
	})

	var held *ddbtypes.ConditionalCheckFailedException
	if errors.As(err, &held) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// releaseAlert gives a claimed key back, so that an alert that could not be delivered is
// tried again next minute instead of being swallowed by its own hold.
func releaseAlert(ctx context.Context, table string, fired alert) {
	_, err := dynamoClient.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(table),
		Key: map[string]ddbtypes.AttributeValue{
			"pk": &ddbtypes.AttributeValueMemberS{Value: "alert#" + fired.key},
		},
	})
	if err != nil {
		log.Printf("could not release the hold on an alert: %v", err)
	}
}

// formatAlerts writes every alert of one run into one message.
func formatAlerts(alerts []alert, now time.Time) string {
	out := &strings.Builder{}
	fmt.Fprintf(out, "🚨 <b>Make It Shorter</b> — %s\n", escape(stampWithZone(now.UnixMilli())))
	for _, fired := range alerts {
		fmt.Fprintf(out, "\n%s\n", fired.text)
	}
	fmt.Fprintf(out, "\n/report 1h")
	return truncateForTelegram(out.String())
}

// runAlerts is one run: check, hold, send, log. With send off it only measures and prints
// what would have gone out, which is how the checks are tried against production from a
// terminal without anyone's phone buzzing.
func runAlerts(ctx context.Context, settings alertSettings, send bool) alertRun {
	now := time.Now()
	alerts, run := checkAlerts(ctx, settings, now)

	if !send {
		for _, fired := range alerts {
			run.Fired = append(run.Fired, fired.key)
		}
		if len(alerts) > 0 {
			fmt.Println(formatAlerts(alerts, now))
		}
		return run
	}

	// Only what is not already held goes out. Device keys carry the device id, so the run
	// log records how many devices fired rather than which.
	fresh := []alert{}
	for _, fired := range alerts {
		claimed, err := holdAlert(ctx, settings.tableName, fired, now)
		if err != nil {
			// Sent unheld rather than dropped: a repeat next minute is a nuisance, a lost
			// alert is the failure this whole thing exists to prevent.
			run.Problems = append(run.Problems, "hold: "+err.Error())
			claimed = true
		}
		if claimed {
			fresh = append(fresh, fired)
			name, _, _ := strings.Cut(fired.key, "#")
			run.Fired = append(run.Fired, name)
		}
	}
	if len(fresh) == 0 {
		return run
	}

	message := formatAlerts(fresh, now)
	if len(allowedChats) == 0 {
		run.Problems = append(run.Problems, "telegram: ALLOWED_CHAT_IDS is empty")
	}
	delivered := 0
	for _, chat := range allowedChats {
		if err := sendMessage(ctx, secrets.BotToken, chat, message); err != nil {
			run.Problems = append(run.Problems, "telegram: "+err.Error())
			continue
		}
		delivered++
	}

	// Nobody got it: give the holds back, and the next run tries again.
	if delivered == 0 {
		for _, fired := range fresh {
			releaseAlert(ctx, settings.tableName, fired)
		}
	}
	return run
}

func logRun(run alertRun) {
	line, err := json.Marshal(run)
	if err != nil {
		log.Printf("could not marshal the run: %v", err)
		return
	}
	log.Print(string(line))
}

func seconds(milliseconds float64) string {
	return fmt.Sprintf("%.1f s", milliseconds/1000)
}
