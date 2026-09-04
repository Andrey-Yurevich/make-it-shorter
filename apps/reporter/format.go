package main

import (
	"fmt"
	"html"
	"log"
	"strings"
	"time"

	// The zone database, compiled into the binary. Lambda's provided.al2023 image carries
	// no /usr/share/zoneinfo, and without this LoadLocation fails there and silently
	// leaves every time in UTC — an hour or two off, with nothing in the message to say so.
	_ "time/tzdata"
)

// The report as a person reads it in Telegram. The JSON the CLI prints is the contract —
// epoch, plain values, no decoration; this is the same numbers dressed for a phone.
//
// Telegram's HTML parse mode, not Markdown. Rule names, error text and log ids all
// contain underscores and asterisks, which Markdown reads as formatting and which make
// Telegram reject the whole message when they fail to pair. HTML needs three characters
// escaped and takes arbitrary text safely, which is the entire reason it is the mode here.

// Central European Time, the same zone the daily quota resets on. A report that counted
// a day differently from the counter it reports on would be a trap.
const reportZone = "Europe/Berlin"

var reportLocation = mustLoadLocation(reportZone)

func mustLoadLocation(name string) *time.Location {
	location, err := time.LoadLocation(name)
	if err != nil {
		log.Printf("could not load the %s zone, falling back to UTC: %v", name, err)
		return time.UTC
	}
	return location
}

func formatReport(built report, region, apiLogGroup string) string {
	out := &strings.Builder{}

	fmt.Fprintf(out, "report — last %s\n", bold(built.Window))
	fmt.Fprintf(out, "%s — %s\n", stamp(built.From), stampWithZone(built.To))

	fmt.Fprintf(out, "\nTotal cost: %s\n", bold(money(built.TotalCostUsd)))

	fmt.Fprintf(out, "\ntop %d countries:\n", topN)
	switch {
	case built.TopCountries == nil:
		fmt.Fprintf(out, "unavailable\n")
	case len(built.TopCountries) == 0:
		fmt.Fprintf(out, "none\n")
	default:
		for _, row := range built.TopCountries {
			cost := row.CostUsd
			fmt.Fprintf(out, "%s %s — %s\n", countryFlag(row.Country), escape(row.Country), bold(money(&cost)))
		}
	}

	if built.Waf == nil {
		fmt.Fprintf(out, "\nWAF blocked: unavailable\n")
	} else {
		fmt.Fprintf(out, "\nWAF blocked: %s\n", bold(fmt.Sprint(built.Waf.Blocked)))
		fmt.Fprintf(out, "top %d rules:\n", topN)
		if len(built.Waf.TopRules) == 0 {
			fmt.Fprintf(out, "none\n")
		} else {
			for _, row := range built.Waf.TopRules {
				fmt.Fprintf(out, "%s — %s\n", escape(row.Rule), bold(fmt.Sprint(row.Hits)))
			}
		}
	}

	switch {
	case built.Lambda == nil:
		fmt.Fprintf(out, "\nLambda errors: unavailable\n")
	case built.Lambda.ErrorRate == nil:
		fmt.Fprintf(out, "\nLambda errors: %s (no invocations)\n", bold(fmt.Sprint(built.Lambda.Errors)))
	default:
		fmt.Fprintf(out, "\nLambda errors: %s (%s of %s invocations)\n",
			bold(fmt.Sprint(built.Lambda.Errors)),
			bold(fmt.Sprintf("%.2f%%", 100**built.Lambda.ErrorRate)),
			bold(fmt.Sprint(built.Lambda.Invocations)))
	}

	fmt.Fprintf(out, "\nlast %d lambda errors:\n", topN)
	switch {
	case built.LastLambdaErrors == nil:
		fmt.Fprintf(out, "unavailable\n")
	case len(built.LastLambdaErrors) == 0:
		fmt.Fprintf(out, "none\n")
	default:
		for _, line := range built.LastLambdaErrors {
			fmt.Fprintf(out, "%s — %s\n",
				logLink(region, apiLogGroup, line.LogStream, line.TimestampMs),
				escape(line.Message))
			if line.ID != "" {
				// Its own line and in code style: Telegram makes that tap-to-copy, and a
				// request id is something you paste into a console search.
				fmt.Fprintf(out, "<code>%s</code>\n", escape(line.ID))
			}
		}
	}

	fmt.Fprintf(out, "\nlast %d llm errors:\n", topN)
	switch {
	case built.LastServiceErrors == nil:
		fmt.Fprintf(out, "unavailable\n")
	case len(built.LastServiceErrors) == 0:
		fmt.Fprintf(out, "none\n")
	default:
		for _, line := range built.LastServiceErrors {
			fmt.Fprintf(out, "%s — %s\n",
				bold(escape(line.ErrorCode)),
				logLink(region, apiLogGroup, line.LogStream, line.TimestampMs))
		}
	}

	// A section that failed is named rather than left as a silent gap, so a report with
	// a hole in it cannot be read as a report of a quiet hour.
	if len(built.Problems) > 0 {
		fmt.Fprintf(out, "\nproblems:\n")
		for _, problem := range built.Problems {
			fmt.Fprintf(out, "%s\n", escape(problem))
		}
	}

	return truncateForTelegram(out.String())
}

// logLink turns a moment into the CloudWatch log stream it happened in — the timestamp
// reads as the time and opens the record.
//
// It is the stream and not the single event: a link to one event needs query parameters
// nested inside the console's own fragment escaping, and a link that opens the right
// stream always works, while one that is almost right opens nothing.
func logLink(region, logGroup, stream string, timestampMs int64) string {
	when := escape(stamp(timestampMs))
	if stream == "" || region == "" || logGroup == "" {
		return when
	}

	url := "https://" + region + ".console.aws.amazon.com/cloudwatch/home?region=" + region +
		"#logsV2:log-groups/log-group/" + consoleEscape(logGroup) +
		"/log-events/" + consoleEscape(stream)

	return `<a href="` + url + `">` + when + `</a>`
}

// consoleEscape writes a value the way the CloudWatch console addresses things inside a
// URL fragment: percent-encoded, and then the percent signs encoded again as "$25". So
// "/aws/lambda/mis-api" becomes "$252Faws$252Flambda$252Fmis-api", and the "[$LATEST]"
// in every Lambda stream name becomes "$255B$2524LATEST$255D".
func consoleEscape(value string) string {
	out := &strings.Builder{}
	for _, b := range []byte(value) {
		if b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9' || b == '-' || b == '_' || b == '.' {
			out.WriteByte(b)
			continue
		}
		fmt.Fprintf(out, "$25%02X", b)
	}
	return out.String()
}

// countryFlag turns a two-letter country code into its flag, which is that code written in
// regional indicator symbols and nothing more. Anything that is not two letters — "??"
// for a record with no country — gets no flag rather than a wrong one.
func countryFlag(country string) string {
	if len(country) != 2 {
		return "🏳"
	}
	runes := []rune(strings.ToUpper(country))
	for _, r := range runes {
		if r < 'A' || r > 'Z' {
			return "🏳"
		}
	}
	const firstRegionalIndicator = 0x1F1E6
	return string(rune(firstRegionalIndicator+runes[0]-'A')) + string(rune(firstRegionalIndicator+runes[1]-'A'))
}

func bold(text string) string { return "<b>" + text + "</b>" }

func escape(text string) string { return html.EscapeString(text) }

func money(usd *float64) string {
	if usd == nil {
		return "unavailable"
	}
	return fmt.Sprintf("$%.4f", *usd)
}

// stamp and stampWithZone read the report's epoch milliseconds back in Central European
// Time. Only the end of the window carries the zone name, because both ends are in it and
// writing it twice says nothing the second time.
func stamp(milliseconds int64) string {
	if milliseconds == 0 {
		return "?"
	}
	return time.UnixMilli(milliseconds).In(reportLocation).Format("2006-01-02 15:04:05")
}

func stampWithZone(milliseconds int64) string {
	if milliseconds == 0 {
		return "?"
	}
	return time.UnixMilli(milliseconds).In(reportLocation).Format("2006-01-02 15:04:05 MST")
}
