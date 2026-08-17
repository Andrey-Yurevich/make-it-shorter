package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// config is everything that can be changed without releasing the extension.
// It is read once at start; a bad value is fatal there, not a surprise on a live request.
type config struct {
	serviceEnabled  bool
	disabledMessage string

	minInput int
	maxInput int

	languages map[string]bool // lowercased normalized codes

	answerTimeout time.Duration
	quotaLocation *time.Location

	tableName       string
	metricNamespace string

	// maxActions is the number the prompt asks the model to stay under. It is global
	// and has no per-tier form: the prompt sits before the first cache breakpoint, so
	// a per-tier number would give each tier its own prefix and split the prompt
	// cache. A tier wanting fewer buttons gets them from the trim in filterActionIDs,
	// and no tier may ask for more than this.
	maxActions int

	tier1Countries map[string]bool
	tier1          requestParams
	rest           requestParams

	modelPrices map[string]modelPrice
}

// requestParams is the complete set for one request: model, both token ceilings,
// button count and daily quota. Both tier sets are complete, spelled out in the
// environment down to the last field — reading the function's environment is
// enough to know what a request from either tier is answered with.
type requestParams struct {
	model            string
	maxSummaryTokens int
	maxAnswerTokens  int
	maxActions       int
	dailyQuota       int
}

// deviceOverride is a partial requestParams, read from the overrides table. A zero
// field means "not set for this device" and leaves the tier value in place. Devices
// are the only partial level: the chain is device override -> geo tier, and every
// country lands in one of the two tiers, including an absent country header.
type deviceOverride struct {
	model            string
	maxSummaryTokens int
	maxAnswerTokens  int
	maxActions       int
	dailyQuota       int
}

// modelPrice is USD per million tokens. Cache reads are priced separately on
// purpose: with pre-generated answers most of the input is read from cache, and
// without that price the cost estimate is several times too high.
type modelPrice struct {
	Input      float64 `json:"input"`
	Output     float64 `json:"output"`
	CacheRead  float64 `json:"cacheRead"`
	CacheWrite float64 `json:"cacheWrite"`
}

func loadConfig() (*config, error) {
	var problems []string

	requiredString := func(name string) string {
		value := os.Getenv(name)
		if value == "" {
			problems = append(problems, name+" is not set")
		}
		return value
	}
	requiredInt := func(name string) int {
		value := os.Getenv(name)
		if value == "" {
			problems = append(problems, name+" is not set")
			return 0
		}
		number, err := strconv.Atoi(value)
		if err != nil {
			problems = append(problems, name+" is not an integer: "+value)
			return 0
		}
		return number
	}
	c := &config{}

	// The kill switch. Anything but an explicit "false" leaves the service on:
	// a typo must not take production down.
	c.serviceEnabled = os.Getenv("SERVICE_ENABLED") != "false"
	c.disabledMessage = os.Getenv("DISABLED_MESSAGE")

	c.minInput = requiredInt("MIN_INPUT")
	c.maxInput = requiredInt("MAX_INPUT")

	c.languages = map[string]bool{}
	for _, code := range strings.Split(requiredString("LANGUAGES"), ",") {
		code = strings.TrimSpace(code)
		if code != "" {
			c.languages[strings.ToLower(code)] = true
		}
	}

	c.answerTimeout = time.Duration(requiredInt("ANSWER_TIMEOUT_SECONDS")) * time.Second

	// Go on provided.al2023 carries no timezone database; `_ "time/tzdata"` in
	// main.go embeds one. Without it this call fails and a swallowed error would
	// silently mean UTC, i.e. the wrong day boundary for every quota counter.
	location, err := time.LoadLocation(requiredString("QUOTA_TIMEZONE"))
	if err != nil {
		problems = append(problems, "QUOTA_TIMEZONE is not a known IANA zone: "+err.Error())
	}
	c.quotaLocation = location

	c.tableName = requiredString("TABLE_NAME")
	c.metricNamespace = requiredString("METRIC_NAMESPACE")

	c.maxActions = requiredInt("MAX_ACTIONS")

	c.tier1Countries = map[string]bool{}
	for _, country := range strings.Split(os.Getenv("TIER1_COUNTRIES"), ",") {
		country = strings.TrimSpace(country)
		if country != "" {
			c.tier1Countries[strings.ToUpper(country)] = true
		}
	}

	// Both sets are required in full, and both are written out field by field rather
	// than through a loop over prefixes: the variable name a Terraform change touches
	// is the name found by searching this file for it.
	c.tier1 = requestParams{
		model:            requiredString("TIER1_MODEL"),
		maxSummaryTokens: requiredInt("TIER1_MAX_SUMMARY_TOKENS"),
		maxAnswerTokens:  requiredInt("TIER1_MAX_ANSWER_TOKENS"),
		maxActions:       requiredInt("TIER1_MAX_ACTIONS"),
		dailyQuota:       requiredInt("TIER1_DAILY_QUOTA"),
	}
	c.rest = requestParams{
		model:            requiredString("REST_MODEL"),
		maxSummaryTokens: requiredInt("REST_MAX_SUMMARY_TOKENS"),
		maxAnswerTokens:  requiredInt("REST_MAX_ANSWER_TOKENS"),
		maxActions:       requiredInt("REST_MAX_ACTIONS"),
		dailyQuota:       requiredInt("REST_DAILY_QUOTA"),
	}

	c.modelPrices = map[string]modelPrice{}
	if prices := os.Getenv("MODEL_PRICES"); prices != "" {
		if err := json.Unmarshal([]byte(prices), &c.modelPrices); err != nil {
			problems = append(problems, "MODEL_PRICES is not valid JSON: "+err.Error())
		}
	} else {
		problems = append(problems, "MODEL_PRICES is not set")
	}

	if c.minInput > 0 && c.maxInput > 0 && c.minInput >= c.maxInput {
		problems = append(problems, "MIN_INPUT is not below MAX_INPUT")
	}

	// MAX_ACTIONS is the number that goes into the prompt, and it is static across all
	// requests, so a tier asking for more buttons than that would never get them: the
	// model is not told it may propose more.
	if c.tier1.maxActions > c.maxActions {
		problems = append(problems, "TIER1_MAX_ACTIONS is above MAX_ACTIONS")
	}
	if c.rest.maxActions > c.maxActions {
		problems = append(problems, "REST_MAX_ACTIONS is above MAX_ACTIONS")
	}

	if len(problems) > 0 {
		return nil, fmt.Errorf("environment: %s", strings.Join(problems, "; "))
	}
	return c, nil
}

// resolveParams walks the chain: the set for the geo tier, then the override for
// this device on top of it, field by field.
//
// The tier set is the floor of the chain and it is complete, so there is nothing
// below it to fall through to. An unknown or absent country is not a third case: it
// is simply not tier 1, and lands in rest.
func resolveParams(device deviceOverride, country string) requestParams {
	resolved := cfg.rest
	if cfg.tier1Countries[strings.ToUpper(country)] {
		resolved = cfg.tier1
	}

	if device.model != "" {
		resolved.model = device.model
	}
	if device.maxSummaryTokens > 0 {
		resolved.maxSummaryTokens = device.maxSummaryTokens
	}
	if device.maxAnswerTokens > 0 {
		resolved.maxAnswerTokens = device.maxAnswerTokens
	}
	if device.maxActions > 0 {
		resolved.maxActions = device.maxActions
	}
	if device.dailyQuota > 0 {
		resolved.dailyQuota = device.dailyQuota
	}

	return resolved
}

// estimateCostUsd converts token counts into dollars for the EstimatedCostUsd
// metric. An unpriced model yields 0 — the log says which model answered, so a
// missing price is visible there rather than guessed at here.
func estimateCostUsd(model string, used tokenUsage) float64 {
	price, known := cfg.modelPrices[model]
	if !known {
		return 0
	}
	const perMillion = 1_000_000.0
	return float64(used.input)*price.Input/perMillion +
		float64(used.output)*price.Output/perMillion +
		float64(used.cacheRead)*price.CacheRead/perMillion +
		float64(used.cacheWrite)*price.CacheWrite/perMillion
}
