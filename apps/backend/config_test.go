package main

import "testing"

func TestResolveParams(t *testing.T) {
	cfg = &config{
		tier1Countries: map[string]bool{"US": true, "DE": true},
		tier1: requestParams{
			model:            "tier1-model",
			maxSummaryTokens: 400,
			dailyQuota:       80,
		},
		rest: requestParams{
			model:            "rest-model",
			maxSummaryTokens: 300,
			dailyQuota:       20,
		},
	}

	t.Run("a tier 1 country takes the tier 1 set whole", func(t *testing.T) {
		got := resolveParams(deviceOverride{}, "US")
		if got != cfg.tier1 {
			t.Errorf("resolveParams = %+v, want the tier 1 set %+v", got, cfg.tier1)
		}
	})

	t.Run("everywhere else takes the rest set whole", func(t *testing.T) {
		got := resolveParams(deviceOverride{}, "BR")
		if got != cfg.rest {
			t.Errorf("resolveParams = %+v, want the rest set %+v", got, cfg.rest)
		}
	})

	t.Run("a device override wins over the tier, field by field", func(t *testing.T) {
		got := resolveParams(deviceOverride{model: "device-model", dailyQuota: 1000}, "US")
		if got.model != "device-model" {
			t.Errorf("model = %q, want device-model", got.model)
		}
		if got.dailyQuota != 1000 {
			t.Errorf("dailyQuota = %d, want 1000", got.dailyQuota)
		}
		if got.maxSummaryTokens != 400 {
			t.Errorf("maxSummaryTokens = %d, want the tier 1 value 400", got.maxSummaryTokens)
		}
	})

	// The tier set is the floor of the chain: there is no level below it, so a request
	// with no country header must still resolve to a complete set.
	t.Run("an absent country is not tier 1 and still resolves in full", func(t *testing.T) {
		if got := resolveParams(deviceOverride{}, ""); got != cfg.rest {
			t.Errorf("resolveParams = %+v, want the rest set %+v", got, cfg.rest)
		}
	})
}

func TestEstimateCostUsd(t *testing.T) {
	cfg = &config{modelPrices: map[string]modelPrice{
		"priced": {Input: 1, Output: 5, CacheRead: 0.1, CacheWrite: 1.25},
	}}

	got := estimateCostUsd("priced", tokenUsage{input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000})
	if got != 7.35 {
		t.Errorf("estimateCostUsd = %v, want 7.35", got)
	}

	if got := estimateCostUsd("unpriced", tokenUsage{input: 1_000_000}); got != 0 {
		t.Errorf("an unpriced model should estimate 0, got %v", got)
	}
}
