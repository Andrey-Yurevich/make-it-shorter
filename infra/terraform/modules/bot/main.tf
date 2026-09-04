variable "artifacts_bucket" { type = string }
variable "bot_version" { type = string }
variable "log_retention_days" { type = number }

variable "api_log_group" { type = string }
variable "waf_log_group" { type = string }
variable "api_function_name" { type = string }
variable "metric_namespace" { type = string }

variable "allowed_chat_ids" { type = list(string) }
variable "reserved_concurrency" {
  type     = number
  nullable = true
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  account = data.aws_caller_identity.current.account_id
  region  = data.aws_region.current.region
}

# The Telegram bot: a webhook that answers five report commands.
#
# It is the same binary as the reporter CLI, built for Lambda. That is deliberate — the
# report a person gets in a chat and the report printed at a terminal are then the same
# code, and cannot drift into disagreeing about the same hour.

resource "aws_cloudwatch_log_group" "bot" {
  name              = "/aws/lambda/mis-bot"
  retention_in_days = var.log_retention_days
}

# --- the secret ---
#
# Created here, filled in by hand. Terraform makes the box and never learns what goes in
# it: a token written into a tfvars file would be committed, and one written into a
# variable would sit in the state file in clear text.
resource "aws_secretsmanager_secret" "bot" {
  name        = "mis-bot"
  description = "Telegram bot token and webhook secret. Set by hand; Terraform only creates the secret."
}

resource "aws_secretsmanager_secret_version" "placeholder" {
  secret_id = aws_secretsmanager_secret.bot.id

  # A placeholder so the shape is documented where it is used, and so the function fails
  # with "missing botToken" rather than with a JSON parse error before anyone has touched it.
  secret_string = jsonencode({
    botToken      = ""
    webhookSecret = ""
  })

  # Without this, the next apply would overwrite the real token with the placeholder above.
  lifecycle {
    ignore_changes = [secret_string]
  }
}

# --- the function ---

resource "aws_iam_role" "bot" {
  name = "mis-bot"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "bot" {
  name = "mis-bot"
  role = aws_iam_role.bot.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadTheBotSecret"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [aws_secretsmanager_secret.bot.arn]
      },
      {
        Sid    = "StartQueriesOnTheTwoLogGroupsItReports"
        Effect = "Allow"
        Action = ["logs:StartQuery"]
        Resource = [
          "arn:aws:logs:${local.region}:${local.account}:log-group:${var.api_log_group}:*",
          "arn:aws:logs:${local.region}:${local.account}:log-group:${var.waf_log_group}:*",
        ]
      },
      {
        # GetQueryResults and GetMetricData take no resource of their own — the API has
        # no resource-level permission for either, so a wildcard is the only thing that
        # can be written here. StartQuery above is where the log groups are actually
        # constrained, and a query cannot be read without having been started.
        Sid    = "ReadQueryResultsAndMetrics"
        Effect = "Allow"
        Action = [
          "logs:GetQueryResults",
          "cloudwatch:GetMetricData",
        ]
        Resource = "*"
      },
      {
        Sid    = "WriteItsOwnLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "${aws_cloudwatch_log_group.bot.arn}:*"
      },
    ]
  })
}

resource "aws_lambda_function" "bot" {
  function_name = "mis-bot"
  role          = aws_iam_role.bot.arn

  s3_bucket = var.artifacts_bucket
  s3_key    = "bot/${var.bot_version}.zip"

  runtime       = "provided.al2023"
  handler       = "bootstrap"
  architectures = ["arm64"]

  # A report is four CloudWatch queries end to end, and Insights answers in seconds
  # rather than milliseconds. The month window is the slow one.
  timeout     = 120
  memory_size = 256

  # A bounded blast radius, when the account allows one: Telegram sends one update at a
  # time per chat, so anything above a handful is either a retry storm or someone who got
  # past the secret. Null today because the account ceiling is 10 and Lambda refuses any
  # reservation that leaves fewer than 10 unreserved — see the variable for the rest. The
  # secret token and the chat allow-list do not depend on this and still hold.
  reserved_concurrent_executions = var.reserved_concurrency

  environment {
    variables = {
      SECRET_ID         = aws_secretsmanager_secret.bot.arn
      API_LOG_GROUP     = var.api_log_group
      WAF_LOG_GROUP     = var.waf_log_group
      API_FUNCTION_NAME = var.api_function_name
      # Empty until the first chat id is known — see answer() in lambda.go for what the
      # bot does in the meantime, which is to tell you the id and nothing else.
      ALLOWED_CHAT_IDS = join(",", var.allowed_chat_ids)
    }
  }

  depends_on = [aws_cloudwatch_log_group.bot]
}

# Telegram signs nothing and can only be handed a URL, so the endpoint has to be open at
# the network level. What actually guards it is in the function: the secret token header
# Telegram sends on every call, and the chat allow-list behind it.
resource "aws_lambda_function_url" "bot" {
  function_name      = aws_lambda_function.bot.function_name
  authorization_type = "NONE"
}

output "webhook_url" { value = aws_lambda_function_url.bot.function_url }
output "secret_arn" { value = aws_secretsmanager_secret.bot.arn }
output "function_name" { value = aws_lambda_function.bot.function_name }
