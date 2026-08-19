variable "alarm_email" { type = string }
variable "daily_cost_alarm_usd" { type = number }
variable "min_invocations_for_alarm" { type = number }
variable "metric_namespace" { type = string }
variable "function_name" { type = string }
variable "log_group_name" { type = string }

resource "aws_sns_topic" "alarms" {
  name = "mis-alarms"
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# --- metrics extracted from the function's structured log ---
#
# The function publishes EstimatedCostUsd and Successes itself; everything else
# an alarm needs is already in the one JSON record per request, so it is read
# from there rather than published as extra custom metrics.

resource "aws_cloudwatch_log_metric_filter" "requests" {
  name           = "mis-requests"
  log_group_name = var.log_group_name
  pattern        = "{ $.event = \"shorten\" }"

  metric_transformation {
    name          = "Requests"
    namespace     = var.metric_namespace
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_log_metric_filter" "upstream_errors" {
  name           = "mis-upstream-errors"
  log_group_name = var.log_group_name
  pattern        = "{ $.errorCode = \"upstream_error\" }"

  metric_transformation {
    name          = "UpstreamErrors"
    namespace     = var.metric_namespace
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_log_metric_filter" "first_token_ms" {
  name           = "mis-first-token-ms"
  log_group_name = var.log_group_name
  pattern        = "{ $.firstTokenMs > 0 }"

  metric_transformation {
    name      = "FirstTokenMs"
    namespace = var.metric_namespace
    value     = "$.firstTokenMs"
    unit      = "Milliseconds"
  }
}

resource "aws_cloudwatch_log_metric_filter" "answers_started" {
  name           = "mis-answers-started"
  log_group_name = var.log_group_name
  pattern        = "{ $.answersStarted > 0 }"

  metric_transformation {
    name      = "AnswersStarted"
    namespace = var.metric_namespace
    value     = "$.answersStarted"
  }
}

resource "aws_cloudwatch_log_metric_filter" "answers_failed" {
  name           = "mis-answers-failed"
  log_group_name = var.log_group_name
  pattern        = "{ $.answersFailedCount > 0 }"

  metric_transformation {
    name      = "AnswersFailed"
    namespace = var.metric_namespace
    value     = "$.answersFailedCount"
  }
}

resource "aws_cloudwatch_log_metric_filter" "cache_read_share" {
  name           = "mis-cache-read-share"
  log_group_name = var.log_group_name
  pattern        = "{ $.tokensIn > 0 }"

  metric_transformation {
    name      = "CacheReadShare"
    namespace = var.metric_namespace
    value     = "$.cacheReadShare"
  }
}

# --- alarms ---

# The main spending control. AWS Budgets is hours behind; this is minutes behind,
# because the function prices each request from its own token counts.
resource "aws_cloudwatch_metric_alarm" "daily_cost" {
  alarm_name          = "mis-daily-cost"
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.daily_cost_alarm_usd
  evaluation_periods  = 1

  metric_name = "EstimatedCostUsd"
  namespace   = var.metric_namespace
  statistic   = "Sum"
  period      = 86400

  treat_missing_data = "notBreaching"
  alarm_actions      = [aws_sns_topic.alarms.arn]
}

# Zero successes is only an alarm when there was traffic to succeed at —
# otherwise it is a night-time idle detector that gets muted within a week.
resource "aws_cloudwatch_metric_alarm" "no_successes" {
  alarm_name          = "mis-no-successes"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  evaluation_periods  = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]

  metric_query {
    id          = "alarm"
    expression  = "IF(invocations >= ${var.min_invocations_for_alarm} AND successes == 0, 1, 0)"
    label       = "Traffic with no successful answers"
    return_data = true
  }

  metric_query {
    id = "invocations"
    metric {
      metric_name = "Invocations"
      namespace   = "AWS/Lambda"
      dimensions  = { FunctionName = var.function_name }
      stat        = "Sum"
      period      = 10800
    }
  }

  metric_query {
    id = "successes"
    metric {
      metric_name = "Successes"
      namespace   = var.metric_namespace
      stat        = "Sum"
      period      = 10800
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "first_token_latency" {
  alarm_name          = "mis-first-token-latency"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 1500
  evaluation_periods  = 1

  metric_name        = "FirstTokenMs"
  namespace          = var.metric_namespace
  extended_statistic = "p95"
  period             = 900

  treat_missing_data = "notBreaching"
  alarm_actions      = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "upstream_error_share" {
  alarm_name          = "mis-upstream-error-share"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0.02
  evaluation_periods  = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]

  metric_query {
    id          = "share"
    expression  = "IF(requests > 0, errors / requests, 0)"
    label       = "Share of upstream_error"
    return_data = true
  }

  metric_query {
    id = "errors"
    metric {
      metric_name = "UpstreamErrors"
      namespace   = var.metric_namespace
      stat        = "Sum"
      period      = 900
    }
  }

  metric_query {
    id = "requests"
    metric {
      metric_name = "Requests"
      namespace   = var.metric_namespace
      stat        = "Sum"
      period      = 900
    }
  }
}

# Catches the quiet degradation where the reader gets a summary with two buttons
# instead of five and no error anywhere.
resource "aws_cloudwatch_metric_alarm" "answer_failure_share" {
  alarm_name          = "mis-answer-failure-share"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0.05
  evaluation_periods  = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]

  metric_query {
    id          = "share"
    expression  = "IF(started > 0, failed / started, 0)"
    label       = "Share of follow-ups that never arrived"
    return_data = true
  }

  metric_query {
    id = "failed"
    metric {
      metric_name = "AnswersFailed"
      namespace   = var.metric_namespace
      stat        = "Sum"
      period      = 900
    }
  }

  metric_query {
    id = "started"
    metric {
      metric_name = "AnswersStarted"
      namespace   = var.metric_namespace
      stat        = "Sum"
      period      = 900
    }
  }
}

# The only failure in this design that shows up on the bill and nowhere else: if
# the second cache breakpoint stops working, the input is paid for six times.
resource "aws_cloudwatch_metric_alarm" "cache_read_share" {
  alarm_name          = "mis-cache-read-share"
  comparison_operator = "LessThanThreshold"
  threshold           = 0.5
  evaluation_periods  = 1

  metric_name = "CacheReadShare"
  namespace   = var.metric_namespace
  statistic   = "Average"
  period      = 3600

  treat_missing_data = "notBreaching"
  alarm_actions      = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "bedrock_throttles" {
  alarm_name          = "mis-bedrock-throttles"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  evaluation_periods  = 1

  metric_name = "InvocationThrottles"
  namespace   = "AWS/Bedrock"
  statistic   = "Sum"
  period      = 300

  treat_missing_data = "notBreaching"
  alarm_actions      = [aws_sns_topic.alarms.arn]
}

# Insurance for the whole account, not a stopping mechanism: billing data is
# hours behind, by which time the money is spent.
resource "aws_budgets_budget" "account" {
  name         = "mis-account"
  budget_type  = "COST"
  limit_amount = tostring(var.daily_cost_alarm_usd * 30)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  dynamic "notification" {
    for_each = [50, 80, 100]
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = [var.alarm_email]
    }
  }
}

output "topic_arn" { value = aws_sns_topic.alarms.arn }
