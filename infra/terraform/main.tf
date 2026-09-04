locals {
  api_domain       = "api.${var.domain}"
  metric_namespace = "MakeItShorter"
}

# Both tier sets are resolved to complete values here, so that reading the function's
# environment answers what a request from either tier is answered with — no field is
# left empty to mean "look somewhere else". The function's chain is therefore two
# levels, a device override on top of a complete tier set, and the default_* base below
# them exists only in Terraform: it is the one place to edit a number meant for
# everyone, and the function never receives it.
#
# Written out twice rather than looped over the field names: an object cannot be indexed
# by a computed key anyway, and spelling it out keeps every variable findable by its own
# name.
locals {
  tier1_params = {
    model              = var.tier1.model != "" ? var.tier1.model : var.default_model
    max_summary_tokens = var.tier1.max_summary_tokens > 0 ? var.tier1.max_summary_tokens : var.default_max_summary_tokens
    daily_quota        = var.tier1.daily_quota > 0 ? var.tier1.daily_quota : var.default_daily_quota
  }

  rest_params = {
    model              = var.rest.model != "" ? var.rest.model : var.default_model
    max_summary_tokens = var.rest.max_summary_tokens > 0 ? var.rest.max_summary_tokens : var.default_max_summary_tokens
    daily_quota        = var.rest.daily_quota > 0 ? var.rest.daily_quota : var.default_daily_quota
  }
}

# The hosted zone is created by hand and adopted here; the records inside it are
# managed by Terraform.
data "aws_route53_zone" "root" {
  name         = "${var.domain}."
  private_zone = false
}

module "artifacts" {
  source      = "./modules/artifacts"
  bucket_name = var.artifacts_bucket
}

module "data" {
  source = "./modules/data"
}

module "api" {
  source = "./modules/api"

  artifacts_bucket     = module.artifacts.bucket_name
  lambda_version       = var.lambda_version
  reserved_concurrency = var.reserved_concurrency
  log_retention_days   = var.log_retention_days

  table_name       = module.data.table_name
  table_arn        = module.data.table_arn
  metric_namespace = local.metric_namespace

  environment = {
    SERVICE_ENABLED  = var.service_enabled ? "true" : "false"
    DISABLED_MESSAGE = var.disabled_message

    MIN_INPUT      = tostring(var.min_input)
    MAX_INPUT      = tostring(var.max_input)
    LANGUAGES      = join(",", var.languages)
    QUOTA_TIMEZONE = var.quota_timezone

    TIER1_COUNTRIES          = join(",", var.tier1_countries)
    TIER1_MODEL              = local.tier1_params.model
    TIER1_MAX_SUMMARY_TOKENS = tostring(local.tier1_params.max_summary_tokens)
    TIER1_DAILY_QUOTA        = tostring(local.tier1_params.daily_quota)

    REST_MODEL              = local.rest_params.model
    REST_MAX_SUMMARY_TOKENS = tostring(local.rest_params.max_summary_tokens)
    REST_DAILY_QUOTA        = tostring(local.rest_params.daily_quota)

    MODEL_PRICES = jsonencode(var.model_prices)
  }
}

module "cdn" {
  source = "./modules/cdn"

  api_domain     = local.api_domain
  zone_id        = data.aws_route53_zone.root.zone_id
  function_url   = module.api.function_url
  function_name  = module.api.function_name
  waf_rate_limit = var.waf_rate_limit

  log_retention_days      = var.log_retention_days
  waf_logs_enabled        = var.waf_logs_enabled
  cloudfront_logs_enabled = var.cloudfront_logs_enabled
}

module "bot" {
  source = "./modules/bot"

  artifacts_bucket   = module.artifacts.bucket_name
  bot_version        = var.bot_version
  log_retention_days = var.log_retention_days

  api_log_group     = module.api.log_group_name
  waf_log_group     = module.cdn.waf_log_group_name
  api_function_name = module.api.function_name
  metric_namespace  = local.metric_namespace

  allowed_chat_ids     = var.telegram_chat_ids
  reserved_concurrency = var.bot_reserved_concurrency
}

module "landing" {
  source = "./modules/landing"

  domain       = var.domain
  zone_id      = data.aws_route53_zone.root.zone_id
  content_root = "${path.module}/../../landing"
}

module "budget" {
  source = "./modules/budget"

  alarm_email               = var.alarm_email
  daily_cost_alarm_usd      = var.daily_cost_alarm_usd
  min_invocations_for_alarm = var.min_invocations_for_alarm

  metric_namespace = local.metric_namespace
  function_name    = module.api.function_name
  log_group_name   = module.api.log_group_name
}
