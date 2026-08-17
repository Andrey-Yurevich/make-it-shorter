package main

import (
	"context"
	"log"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatch"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatch/types"
)

// Two metrics the function publishes about itself.
//
// EstimatedCostUsd: the function knows its token counts and the price of the model it
// used, so it can price a request a minute after serving it. AWS Budgets is hours
// behind, by which time the money is spent.
//
// Successes: a request that reached done. The Lambda invocation metric cannot stand in
// for it — an error delivered as an SSE event is, to Lambda, a successful invocation.
func publishMetrics(costUsd float64, success bool) {
	// A request rejected before Bedrock spent neither money nor a success, and there is
	// nothing about it worth a metric call.
	if costUsd == 0 && !success {
		return
	}

	data := []types.MetricDatum{{
		MetricName: aws.String("EstimatedCostUsd"),
		Value:      aws.Float64(costUsd),
		Unit:       types.StandardUnitNone,
	}}
	if success {
		data = append(data, types.MetricDatum{
			MetricName: aws.String("Successes"),
			Value:      aws.Float64(1),
			Unit:       types.StandardUnitCount,
		})
	}

	// The response is already delivered by now, so this must not hold the invocation
	// open for long, and a failure here must not turn a served request into a failed one.
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	_, err := cloudwatchClient.PutMetricData(ctx, &cloudwatch.PutMetricDataInput{
		Namespace:  aws.String(cfg.metricNamespace),
		MetricData: data,
	})
	if err != nil {
		log.Printf("could not publish metrics: %v", err)
	}
}
