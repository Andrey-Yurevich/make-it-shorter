package main

import (
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatch"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatchlogs"
)

// Two clients, built once in main and read everywhere else. Package-level because this
// is a one-shot command with one configuration: threading them through every call would
// be ceremony around a value that never differs.

var (
	logsClient    *cloudwatchlogs.Client
	metricsClient *cloudwatch.Client
)

func newClients(awsConfig aws.Config) {
	logsClient = cloudwatchlogs.NewFromConfig(awsConfig)
	metricsClient = cloudwatch.NewFromConfig(awsConfig)
}
