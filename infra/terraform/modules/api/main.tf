variable "artifacts_bucket" { type = string }
variable "lambda_version" { type = string }
variable "reserved_concurrency" {
  type     = number
  nullable = true
}

variable "log_retention_days" { type = number }
variable "table_name" { type = string }
variable "table_arn" { type = string }
variable "metric_namespace" { type = string }
variable "environment" { type = map(string) }

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  account = data.aws_caller_identity.current.account_id
  region  = data.aws_region.current.region
}

resource "aws_cloudwatch_log_group" "function" {
  name              = "/aws/lambda/mis-api"
  retention_in_days = var.log_retention_days
}

resource "aws_iam_role" "function" {
  name = "mis-api"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# Minimal policy, no wildcards in resources.
resource "aws_iam_role_policy" "function" {
  name = "mis-api"
  role = aws_iam_role.function.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid = "Bedrock"
        # Both actions are needed: phase 1 streams (ConverseStream) and phase 2
        # does not (Converse). The inference profile and every regional model it
        # can route to must be listed, or the call is denied at the profile.
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
        ]
        Resource = [
          "arn:aws:bedrock:${local.region}:${local.account}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0",
          "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
          "arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
          "arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
        ]
      },
      {
        Sid      = "Quota"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
        Resource = var.table_arn
      },
      {
        Sid      = "Metrics"
        Effect   = "Allow"
        Action   = "cloudwatch:PutMetricData"
        Resource = "*"
        Condition = {
          StringEquals = { "cloudwatch:namespace" = var.metric_namespace }
        }
      },
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.function.arn}:*"
      },
    ]
  })
}

resource "aws_lambda_function" "api" {
  function_name = "mis-api"
  role          = aws_iam_role.function.arn

  s3_bucket = var.artifacts_bucket
  s3_key    = "lambda/${var.lambda_version}.zip"

  runtime       = "provided.al2023"
  handler       = "bootstrap"
  architectures = ["arm64"]

  # 128 MB because the function waits on Bedrock rather than computing. Timeout
  # 50s and not 60: CloudFront's origin read timeout has to expire second, and
  # its own ceiling without a quota request is 60.
  memory_size = 128
  timeout     = 50

  # Null means no reservation. The account's own ceiling is 10 concurrent
  # executions in total, and AWS refuses any reservation that leaves fewer than
  # 10 unreserved — so on this account the account-wide limit is already a
  # tighter bound than the reservation would be. Set the variable once the
  # account limit is raised.
  reserved_concurrent_executions = var.reserved_concurrency

  environment {
    variables = merge(var.environment, {
      TABLE_NAME       = var.table_name
      METRIC_NAMESPACE = var.metric_namespace
    })
  }

  depends_on = [aws_cloudwatch_log_group.function]
}

resource "aws_lambda_function_url" "api" {
  function_name      = aws_lambda_function.api.function_name
  authorization_type = "AWS_IAM"
  invoke_mode        = "RESPONSE_STREAM"
}

output "function_name" { value = aws_lambda_function.api.function_name }
output "function_arn" { value = aws_lambda_function.api.arn }
output "function_url" { value = aws_lambda_function_url.api.function_url }
output "log_group_name" { value = aws_cloudwatch_log_group.function.name }
