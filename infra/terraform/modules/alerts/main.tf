variable "artifacts_bucket" { type = string }
variable "bot_version" { type = string }
variable "log_retention_days" { type = number }

variable "api_function_name" { type = string }
variable "api_log_group" { type = string }
variable "table_name" { type = string }
variable "table_arn" { type = string }
variable "distribution_id" { type = string }

variable "bot_secret_arn" { type = string }
variable "allowed_chat_ids" { type = list(string) }

variable "invocations_1m" { type = number }
variable "invocations_5m" { type = number }
variable "invocations_15m" { type = number }
variable "daily_budget_usd" { type = number }
variable "device_daily_calls" { type = number }
variable "first_token_p95_ms" { type = number }

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  account = data.aws_caller_identity.current.account_id
  region  = data.aws_region.current.region
}

# All alerting, in one function: EventBridge runs it once a minute, it measures the API and
# writes to the Telegram chats the bot answers. There are no CloudWatch alarms and no SNS
# topic — a threshold lives in this module's variables, and a message goes out as the bot.
#
# It is the bot's binary, the same zip, started with MODE=alerts. The checks reuse the
# report's own queries, so an alert and "/report" cannot disagree about the same hour.

resource "aws_cloudwatch_log_group" "alerts" {
  name              = "/aws/lambda/mis-alerts"
  retention_in_days = var.log_retention_days
}

resource "aws_iam_role" "alerts" {
  name = "mis-alerts"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "alerts" {
  name = "mis-alerts"
  role = aws_iam_role.alerts.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # The bot's secret: the alerter speaks as the bot.
        Sid      = "ReadTheBotSecret"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [var.bot_secret_arn]
      },
      {
        Sid      = "StartQueriesOnTheApiLog"
        Effect   = "Allow"
        Action   = ["logs:StartQuery"]
        Resource = ["arn:aws:logs:${local.region}:${local.account}:log-group:${var.api_log_group}:*"]
      },
      {
        # Neither action has a resource-level permission, so a wildcard is the only thing
        # that can be written; StartQuery above is where the log group is constrained.
        Sid      = "ReadQueryResultsAndMetrics"
        Effect   = "Allow"
        Action   = ["logs:GetQueryResults", "cloudwatch:GetMetricData"]
        Resource = "*"
      },
      {
        # The quota counters, read for the per-device check.
        Sid      = "ScanTheQuotaCounters"
        Effect   = "Allow"
        Action   = ["dynamodb:Scan"]
        Resource = [var.table_arn]
      },
      {
        # The holds that keep a lasting condition from being said every minute. Writes are
        # confined to alert# keys: the alerter has no business touching a counter or an
        # override.
        Sid      = "WriteAlertHoldsOnly"
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem", "dynamodb:DeleteItem"]
        Resource = [var.table_arn]
        Condition = {
          "ForAllValues:StringLike" = { "dynamodb:LeadingKeys" = ["alert#*"] }
        }
      },
      {
        Sid      = "WriteItsOwnLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.alerts.arn}:*"
      },
    ]
  })
}

resource "aws_lambda_function" "alerts" {
  function_name = "mis-alerts"
  role          = aws_iam_role.alerts.arn

  s3_bucket = var.artifacts_bucket
  s3_key    = "bot/${var.bot_version}.zip"

  runtime       = "provided.al2023"
  handler       = "bootstrap"
  architectures = ["arm64"]

  # Three Insights queries one after another, a few seconds each. Under a minute so that
  # one run is over before the next starts.
  timeout     = 55
  memory_size = 256

  environment {
    variables = {
      MODE = "alerts"

      SECRET_ID        = var.bot_secret_arn
      ALLOWED_CHAT_IDS = join(",", var.allowed_chat_ids)

      API_FUNCTION_NAME = var.api_function_name
      API_LOG_GROUP     = var.api_log_group
      TABLE_NAME        = var.table_name
      DISTRIBUTION_ID   = var.distribution_id

      INVOCATIONS_1M     = tostring(var.invocations_1m)
      INVOCATIONS_5M     = tostring(var.invocations_5m)
      INVOCATIONS_15M    = tostring(var.invocations_15m)
      DAILY_BUDGET_USD   = tostring(var.daily_budget_usd)
      DEVICE_DAILY_CALLS = tostring(var.device_daily_calls)
      FIRST_TOKEN_P95_MS = tostring(var.first_token_p95_ms)
    }
  }

  depends_on = [aws_cloudwatch_log_group.alerts]
}

# A scheduled run that fails is retried by Lambda's async invocation, and the next minute
# runs anyway; there is nothing to gain from a retry that lands on top of the next run.
resource "aws_lambda_function_event_invoke_config" "alerts" {
  function_name          = aws_lambda_function.alerts.function_name
  maximum_retry_attempts = 0
}

resource "aws_cloudwatch_event_rule" "alerts" {
  name                = "mis-alerts"
  description         = "Runs the alert checks."
  schedule_expression = "rate(1 minute)"
}

resource "aws_cloudwatch_event_target" "alerts" {
  rule = aws_cloudwatch_event_rule.alerts.name
  arn  = aws_lambda_function.alerts.arn
}

resource "aws_lambda_permission" "alerts" {
  statement_id  = "AllowEventBridgeSchedule"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.alerts.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.alerts.arn
}

output "function_name" { value = aws_lambda_function.alerts.function_name }
