package main

import (
	"strings"
	"testing"
	"time"
)

func minutes(start time.Time, values ...float64) map[time.Time]float64 {
	points := map[time.Time]float64{}
	for i, value := range values {
		points[start.Add(time.Duration(i)*time.Minute)] = value
	}
	return points
}

func TestBusiestWindowFindsTheSpikeWhereverItIs(t *testing.T) {
	start := time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)
	points := minutes(start, 1, 0, 4, 9, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3)

	cases := []struct {
		width time.Duration
		want  float64
	}{
		{time.Minute, 9},
		{5 * time.Minute, 16},  // 1+0+4+9+2
		{15 * time.Minute, 18}, // 4+9+2 and the 3 at minute 16, the first minute dropped
		{20 * time.Minute, 19}, // all of it
	}
	for _, c := range cases {
		if got := busiestWindow(points, c.width); got != c.want {
			t.Errorf("busiest %s window: got %v, want %v", c.width, got, c.want)
		}
	}

	if got := busiestWindow(map[time.Time]float64{}, time.Minute); got != 0 {
		t.Errorf("a window with no datapoints is quiet, got %v", got)
	}
}

func TestCount5xxRoundsEveryErrorUp(t *testing.T) {
	start := time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)
	requests := minutes(start, 3, 200, 7)
	rate := minutes(start, 33.3333, 1.5, 0)

	// One of three, three of two hundred, none of seven.
	if got := count5xx(requests, rate); got != 4 {
		t.Errorf("got %d 5xx, want 4", got)
	}

	// A share with no request count behind it has nothing to be a share of.
	if got := count5xx(map[time.Time]float64{}, minutes(start, 100)); got != 0 {
		t.Errorf("no requests means no responses to count, got %d", got)
	}
}

func TestQuotaKeysAreReadTheWayTheAPIWritesThem(t *testing.T) {
	id, day, ok := parseQuotaKey("quota#2b1c7a4e-0f5d-4a3b-9c8d-1e2f3a4b5c6d#2026-10-18")
	if !ok || id != "2b1c7a4e-0f5d-4a3b-9c8d-1e2f3a4b5c6d" || day != "2026-10-18" {
		t.Errorf("got %q %q %v", id, day, ok)
	}

	for _, key := range []string{"device#2b1c7a4e", "quota#", "quota#abc", "quota#abc#", "alert#budget#2026-10-18"} {
		if _, _, ok := parseQuotaKey(key); ok {
			t.Errorf("%q is not a quota counter and must not be read as one", key)
		}
	}
}

func TestTodayIsTheQuotaDayInBerlin(t *testing.T) {
	// 23:30 UTC on the 18th is already the 19th in Berlin, summer time or not.
	now := time.Date(2026, 10, 18, 23, 30, 0, 0, time.UTC)
	start := startOfDay(now)
	if got := start.Format("2006-01-02 15:04 MST"); got != "2026-10-19 00:00 CEST" {
		t.Errorf("start of day: got %s", got)
	}
	if !start.Before(now) || now.Sub(start) > 24*time.Hour {
		t.Errorf("start of day %s is not the midnight before %s", start, now)
	}
}

func TestAlertSettingsAreAllRequired(t *testing.T) {
	full := map[string]string{
		"API_FUNCTION_NAME":  "mis-api",
		"API_LOG_GROUP":      "/aws/lambda/mis-api",
		"TABLE_NAME":         "mis-data",
		"DISTRIBUTION_ID":    "E123",
		"INVOCATIONS_1M":     "10",
		"INVOCATIONS_5M":     "50",
		"INVOCATIONS_15M":    "150",
		"DAILY_BUDGET_USD":   "10",
		"DEVICE_DAILY_CALLS": "20",
		"FIRST_TOKEN_P95_MS": "2000",
	}
	for name, value := range full {
		t.Setenv(name, value)
	}

	settings, err := loadAlertSettings()
	if err != nil {
		t.Fatalf("a complete environment was rejected: %v", err)
	}
	if settings.invocationLimits[2] != (invocationLimit{minutes: 15, limit: 150}) || settings.dailyBudgetUsd != 10 || settings.firstTokenP95Ms != 2000 {
		t.Errorf("settings read wrong: %+v", settings)
	}

	for name := range full {
		t.Run(name, func(t *testing.T) {
			t.Setenv(name, "")
			if _, err := loadAlertSettings(); err == nil || !strings.Contains(err.Error(), name) {
				t.Errorf("a missing %s must be fatal and named, got %v", name, err)
			}
		})
	}

	t.Setenv("INVOCATIONS_1M", "0")
	if _, err := loadAlertSettings(); err == nil {
		t.Error("a limit of zero fires every minute and must be refused")
	}
}

func TestAlertMessageCarriesEveryAlert(t *testing.T) {
	now := time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)
	message := formatAlerts([]alert{
		{key: "invocations-1m", text: "📈 <b>Invocations</b>: <b>11</b> in 1 min (limit 10)"},
		{key: "budget#2026-10-18", text: "💸 <b>Daily budget spent</b>"},
	}, now)

	for _, want := range []string{"Invocations", "Daily budget spent", "2026-10-18 14:00:00 CEST", "/report 1h"} {
		if !strings.Contains(message, want) {
			t.Errorf("the message is missing %q:\n%s", want, message)
		}
	}
}
