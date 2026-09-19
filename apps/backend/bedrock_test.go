package main

import "testing"

// The two generations get different requests: temperature for the earlier one, thinking
// switched off for the current one. Sending temperature to Claude 5 is a 400 on every
// request, so the model the tiers run has to land on the right side of this.
func TestTakesTemperatureTellsTheGenerationsApart(t *testing.T) {
	cases := map[string]bool{
		"us.anthropic.claude-haiku-4-5-20251001-v1:0": true,
		"us.anthropic.claude-sonnet-4-6":              true,
		"us.anthropic.claude-sonnet-5":                false,
		"global.anthropic.claude-sonnet-5":            false,
		"us.anthropic.claude-opus-5":                  false,
	}
	for model, want := range cases {
		if got := takesTemperature(model); got != want {
			t.Errorf("takesTemperature(%q) = %v, want %v", model, got, want)
		}
	}
}
