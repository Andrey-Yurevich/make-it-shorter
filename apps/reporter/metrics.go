package main

import (
	"context"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatch"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatch/types"
)

// lambdaErrorCounts returns invocations that failed at the Lambda level and invocations
// in total, over the window.
//
// These are the platform's own counters, not the function's. They count a handler that
// panicked or ran out of time — not a request answered with an error event, which to
// Lambda is a success and which the log queries report instead. Both numbers matter and
// they mean different things: this one being zero is the normal, healthy state.
func lambdaErrorCounts(ctx context.Context, function string, start, end time.Time) (errorCount, invocations int, err error) {
	period := metricPeriod(end.Sub(start))

	out, err := metricsClient.GetMetricData(ctx, &cloudwatch.GetMetricDataInput{
		StartTime: aws.Time(start),
		EndTime:   aws.Time(end),
		MetricDataQueries: []types.MetricDataQuery{
			lambdaSum("errors", "Errors", function, period),
			lambdaSum("invocations", "Invocations", function, period),
		},
	})
	if err != nil {
		return 0, 0, fmt.Errorf("could not read Lambda metrics: %w", err)
	}

	// The window can span several periods, so each series is summed rather than read
	// from a single datapoint. A metric with no data at all comes back with no values,
	// which is the zero we want.
	for _, result := range out.MetricDataResults {
		total := 0
		for _, value := range result.Values {
			total += int(value)
		}
		switch aws.ToString(result.Id) {
		case "errors":
			errorCount = total
		case "invocations":
			invocations = total
		}
	}
	return errorCount, invocations, nil
}

func lambdaSum(id, metricName, function string, period int32) types.MetricDataQuery {
	return types.MetricDataQuery{
		Id: aws.String(id),
		MetricStat: &types.MetricStat{
			Metric: &types.Metric{
				Namespace:  aws.String("AWS/Lambda"),
				MetricName: aws.String(metricName),
				Dimensions: []types.Dimension{{
					Name:  aws.String("FunctionName"),
					Value: aws.String(function),
				}},
			},
			Period: aws.Int32(period),
			Stat:   aws.String("Sum"),
		},
	}
}

// metricPeriod picks a granularity that covers the window in as few datapoints as
// possible. CloudWatch takes the period in whole minutes and will not go coarser than
// a day, so a month comes back as thirty datapoints and is summed by the caller.
func metricPeriod(span time.Duration) int32 {
	const day = 86400
	seconds := int32(span.Seconds())
	seconds -= seconds % 60
	if seconds < 60 {
		return 60
	}
	if seconds > day {
		return day
	}
	return seconds
}
