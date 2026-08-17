package main

import (
	"context"
	"testing"
	"time"
)

// The budget of the spec: the function lives 50 seconds, phase 2 gets 25 of them, and
// phase 1 gets what is left minus a moment to write the answers and done.
func TestPhaseOneLeavesRoomForPhaseTwo(t *testing.T) {
	cfg = &config{answerTimeout: 25 * time.Second}

	ctx, cancelInvocation := context.WithTimeout(context.Background(), 50*time.Second)
	defer cancelInvocation()

	phase1Ctx, cancel := phaseOneContext(ctx)
	defer cancel()

	deadline, ok := phase1Ctx.Deadline()
	if !ok {
		t.Fatal("phase 1 must be bounded when the invocation has a deadline")
	}
	if left := time.Until(deadline); left < 22*time.Second || left > 23*time.Second {
		t.Errorf("phase 1 got %v, want about 23s: 50 minus phase 2's 25 minus the 2s to write the answers", left)
	}
}

// An answer timeout at or above the function timeout must not leave phase 1 with
// nothing: that would turn every request into upstream_error instead of a slow one.
func TestPhaseOneSurvivesAMisconfiguredAnswerTimeout(t *testing.T) {
	cfg = &config{answerTimeout: 49 * time.Second}

	ctx, cancelInvocation := context.WithTimeout(context.Background(), 50*time.Second)
	defer cancelInvocation()

	phase1Ctx, cancel := phaseOneContext(ctx)
	defer cancel()

	deadline, _ := phase1Ctx.Deadline()
	if left := time.Until(deadline); left < 24*time.Second {
		t.Errorf("phase 1 got %v, want at least half of what the invocation had left", left)
	}
}

// Locally there is no invocation deadline and nothing to divide.
func TestPhaseOneIsUnboundedWithoutAnInvocationDeadline(t *testing.T) {
	cfg = &config{answerTimeout: 25 * time.Second}

	phase1Ctx, cancel := phaseOneContext(context.Background())
	defer cancel()

	if _, ok := phase1Ctx.Deadline(); ok {
		t.Error("phase 1 should not invent a deadline that the invocation does not have")
	}
}
