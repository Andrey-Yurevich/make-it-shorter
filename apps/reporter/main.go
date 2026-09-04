package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/aws/aws-sdk-go-v2/config"
)

// One operational report over a time window: what was spent, where it was spent, what
// the WebACL stopped, and what went wrong.
//
// The same binary is both halves of the reporting. On a terminal it prints the report as
// JSON; inside Lambda it is the Telegram bot's webhook and answers the same report as a
// message. See runLambda in lambda.go.
//
//	cd apps/reporter && go run . -window 24h
//
// Its own Go module, like apps/backend, so it is run from its own directory. There is
// deliberately no go.work tying the two together: a workspace would resolve both
// modules against one build list, and the AWS SDK versions they pin differ — the
// release script builds the Lambda with a plain `go build` in apps/backend, and a
// workspace would quietly change which SDK ends up in production.
//
// Everything is read from the API function's own CloudWatch data — the structured log
// record it writes per request, through Logs Insights, and the Lambda platform counters,
// through CloudWatch metrics. Nothing is written anywhere.

const topN = 5

// The report, and the shape the Telegram bot will later read. Three conventions run
// through it, and all three matter to whoever consumes this:
//
// Every time is epoch milliseconds, UTC. One unit throughout, and the same one
// CloudWatch keeps log timestamps in, so nothing is converted twice on the way here.
//
// An empty list means the window was quiet. A null means the query behind it failed,
// and `problems` says which one — so a zero that was never measured can never be read
// as a zero that was.
type report struct {
	Window string `json:"window"`
	From   int64  `json:"from"`
	To     int64  `json:"to"`

	TotalCostUsd *float64      `json:"totalCostUsd"`
	TopCountries []countryCost `json:"topCountries"`

	Waf *wafSection `json:"waf"`

	Lambda            *lambdaStats   `json:"lambda"`
	LastLambdaErrors  []lambdaError  `json:"lastLambdaErrors"`
	LastServiceErrors []serviceError `json:"lastServiceErrors"`

	Problems []string `json:"problems"`
}

type countryCost struct {
	Country string  `json:"country"`
	CostUsd float64 `json:"costUsd"`
}

// wafSection counts what the WebACL stopped at the edge, before any of it reached the
// function. None of it appears anywhere else in this report: a request blocked by WAF
// never becomes an invocation and never writes a log record.
type wafSection struct {
	Blocked  int       `json:"blocked"`
	TopRules []ruleHit `json:"topRules"`
}

type ruleHit struct {
	Rule string `json:"rule"`
	Hits int    `json:"hits"`
}

type lambdaStats struct {
	Errors      int `json:"errors"`
	Invocations int `json:"invocations"`
	// Null rather than zero when there were no invocations to divide by.
	ErrorRate *float64 `json:"errorRate"`
}

type lambdaError struct {
	TimestampMs int64 `json:"timestampMs"`
	// The Lambda request id, present only on lines the runtime itself wrote.
	ID string `json:"id"`
	// The full log stream name. Whole, not shortened: it is the address of the record in
	// the console, and the bot turns it into a link.
	LogStream string `json:"logStream"`
	Message   string `json:"message"`
}

type serviceError struct {
	TimestampMs int64  `json:"timestampMs"`
	ErrorCode   string `json:"errorCode"`
	ID          string `json:"id"`
	LogStream   string `json:"logStream"`
}

func main() {
	// One binary, two ways in. Under Lambda the runtime sets AWS_LAMBDA_RUNTIME_API, and
	// nothing else does; on a terminal it is absent and the flags below apply. Keeping
	// them in one binary is what lets the bot answer with exactly the report the CLI
	// prints, rather than with a second implementation of it that drifts.
	if os.Getenv("AWS_LAMBDA_RUNTIME_API") != "" {
		runLambda()
		return
	}

	window := flag.String("window", "24h", "report window: 30m, 1h, 12h, 24h or month")
	logGroup := flag.String("log-group", "/aws/lambda/mis-api", "the API function's log group")
	wafLogGroup := flag.String("waf-log-group", "aws-waf-logs-mis-api", "the WebACL's log group")
	function := flag.String("function", "mis-api", "the API function's name, for Lambda metrics")
	region := flag.String("region", "us-east-1", "AWS region")
	flag.Parse()

	span, err := parseWindow(*window)
	if err != nil {
		log.Fatal(err)
	}

	ctx := context.Background()
	awsConfig, err := config.LoadDefaultConfig(ctx, config.WithRegion(*region))
	if err != nil {
		log.Fatalf("could not load AWS configuration: %v", err)
	}
	newClients(awsConfig)

	// One end for every query, taken once: four queries started a second apart over
	// "now" would each cover a slightly different window, and the numbers in one report
	// would not add up to each other.
	end := time.Now().UTC()
	start := end.Add(-span)

	// Indented, and with a trailing newline: the report is read by a person as often as
	// by a program, and jq should not be needed to look at it.
	line, err := json.MarshalIndent(buildReport(ctx, *logGroup, *wafLogGroup, *function, *window, start, end), "", "  ")
	if err != nil {
		log.Fatalf("could not marshal the report: %v", err)
	}
	os.Stdout.Write(append(line, '\n'))
}

// parseWindow accepts the five windows the bot will offer as commands. Anything else
// Go can parse as a duration is accepted too — it costs nothing and makes the script
// usable for a one-off question — but "month" has to be spelled out, because a month
// is not a duration and Go will not parse it.
func parseWindow(window string) (time.Duration, error) {
	if window == "month" {
		return 30 * 24 * time.Hour, nil
	}
	span, err := time.ParseDuration(window)
	if err != nil {
		return 0, fmt.Errorf("unknown window %q: use 30m, 1h, 12h, 24h or month", window)
	}
	if span <= 0 {
		return 0, fmt.Errorf("window %q is not positive", window)
	}
	return span, nil
}

// buildReport gathers every section and returns the whole report.
//
// The sections run one after another rather than in parallel. Logs Insights takes a few
// seconds per query, so the whole report takes five to fifteen; that is the price of a
// function that can be read top to bottom, and a report nobody is waiting on can pay it.
//
// A failed section leaves its field null and adds a line to problems, and the rest of
// the report is still built: half a report beats an error when the half that works is
// the half that says how much money is going out.
func buildReport(ctx context.Context, logGroup, wafLogGroup, function, window string, start, end time.Time) report {
	built := report{
		Window:   window,
		From:     start.UnixMilli(),
		To:       end.UnixMilli(),
		Problems: []string{},
	}

	countries, err := costByCountry(ctx, logGroup, start, end)
	if err != nil {
		built.Problems = append(built.Problems, "cost by country: "+err.Error())
	} else {
		// The query returns every country so that the total and the leaderboard come
		// from one scan; the cut to five happens here.
		total := 0.0
		built.TopCountries = []countryCost{}
		for i, row := range countries {
			total += row.cost
			if i < topN {
				built.TopCountries = append(built.TopCountries, countryCost{Country: row.key, CostUsd: row.cost})
			}
		}
		built.TotalCostUsd = &total
	}

	// An empty name is how Terraform says the WebACL is not writing logs at all. Left as
	// a null section with a reason rather than as a zero: a report that showed nothing
	// blocked while nothing was counting would be a lie in the most reassuring direction.
	if wafLogGroup == "" {
		built.Problems = append(built.Problems, "waf activity: logging is switched off (waf_logs_enabled)")
	} else if waf, err := readWafActivity(ctx, wafLogGroup, start, end); err != nil {
		built.Problems = append(built.Problems, "waf activity: "+err.Error())
	} else {
		section := wafSection{Blocked: waf.blocked, TopRules: []ruleHit{}}
		for i, row := range waf.topRules {
			if i == topN {
				break
			}
			section.TopRules = append(section.TopRules, ruleHit{Rule: row.rule, Hits: row.hits})
		}
		built.Waf = &section
	}

	errorCount, invocations, err := lambdaErrorCounts(ctx, function, start, end)
	if err != nil {
		built.Problems = append(built.Problems, "lambda metrics: "+err.Error())
	} else {
		stats := lambdaStats{Errors: errorCount, Invocations: invocations}
		if invocations > 0 {
			rate := float64(errorCount) / float64(invocations)
			stats.ErrorRate = &rate
		}
		built.Lambda = &stats
	}

	lambdaErrors, err := lastLambdaErrors(ctx, logGroup, start, end)
	if err != nil {
		built.Problems = append(built.Problems, "last lambda errors: "+err.Error())
	} else {
		built.LastLambdaErrors = []lambdaError{}
		for _, line := range lambdaErrors {
			built.LastLambdaErrors = append(built.LastLambdaErrors, lambdaError{TimestampMs: line.timestampMs, ID: line.id, LogStream: line.stream, Message: line.text})
		}
	}

	serviceErrors, err := lastServiceErrors(ctx, logGroup, start, end)
	if err != nil {
		built.Problems = append(built.Problems, "last service errors: "+err.Error())
	} else {
		built.LastServiceErrors = []serviceError{}
		for _, line := range serviceErrors {
			built.LastServiceErrors = append(built.LastServiceErrors, serviceError{TimestampMs: line.timestampMs, ErrorCode: line.text, ID: line.id, LogStream: line.stream})
		}
	}

	return built
}
