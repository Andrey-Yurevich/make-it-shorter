variable "domain" {
  type    = string
  default = "make-it-shorter.net"
}

variable "artifacts_bucket" {
  type    = string
  default = "mis-artifacts"
}

# The build to run, as the name printed by make-release.sh: the tag on the built commit,
# or its short sha. Deploying is changing this value; rolling back is changing it back.
variable "lambda_version" {
  type = string
}

# --- limits and switches, all readable by the function as environment variables ---

variable "service_enabled" {
  type    = bool
  default = true
}

variable "disabled_message" {
  type        = string
  default     = ""
  description = "English text shown as is with service_disabled. Empty means the extension shows its own localized string."
}

variable "min_input" {
  type    = number
  default = 20
}

variable "max_input" {
  type    = number
  default = 30000
}

# The output languages the service serves, and the server side of the pair: the
# extension's picker carries the same 57 codes with English labels, and the two lists
# are equal — the client list may never be wider, or it offers a language answered with
# unsupported_language. Every code here must have a name in the function's languageNames
# table, or the function refuses to start.
#
# No variant is split: pt-BR and pt-PT are both "pt", zh-Hans and zh-Hant are both "zh"
# (written as Simplified Chinese), Serbian is one entry whatever the script. The
# function folds the old split codes onto these, so older builds keep working.
variable "languages" {
  type = list(string)
  default = [
    # western Europe
    "en", "es", "pt", "fr", "de", "it", "nl",
    # the Nordics
    "sv", "da", "nb", "fi",
    # central, eastern and southeastern Europe
    "pl", "cs", "sk", "sl", "hr", "sr", "bg", "ro", "hu", "el", "sq", "mk",
    # eastern Europe and the Baltics
    "ru", "uk", "be", "lt", "lv", "et",
    # the Caucasus and central Asia
    "ka", "hy", "az", "kk", "uz",
    # the Middle East
    "tr", "he", "ar", "fa", "ur",
    # south Asia
    "hi", "bn", "pa", "gu", "mr", "ta", "te", "ml",
    # southeast Asia
    "th", "vi", "id", "ms", "tl",
    # east Asia
    "zh", "ja", "ko",
    # Africa
    "sw", "af",
  ]
}

variable "quota_timezone" {
  type    = string
  default = "Europe/Berlin"
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "reserved_concurrency" {
  type        = number
  nullable    = true
  default     = null
  description = "Counted against Bedrock, not Lambda: one client request is one model call. Null while the account ceiling is 10 — AWS rejects any reservation that leaves fewer than 10 unreserved, so the account limit binds tighter than the reservation would."
}

# --- logging switches ---
#
# Both are per-gigabyte-ingested, and they answer different questions: the WAF group says
# what was stopped and by which rule, the CloudFront group says what arrived at all. The
# first is cheap — a logging filter drops allowed requests before they are written — and
# is meant to stay on. The second has no such filter and logs every request, so it is the
# one to turn off again once whatever it was opened for has been answered.

variable "waf_logs_enabled" {
  type        = bool
  default     = true
  description = "Blocked and counted requests, with the rule that decided and the headers that arrived. Off means the reporter says the WAF section is unavailable rather than reporting zero."
}

variable "cloudfront_logs_enabled" {
  type        = bool
  default     = true
  description = "Every request the distribution serves, allowed ones included. Volume, and therefore money, scales with traffic rather than with incidents."
}

variable "landing_logs_enabled" {
  type        = bool
  default     = true
  description = "Access logs for the landing distribution. This is the only place an uninstall leaves a trace: Chrome opens /uninstall when the extension is removed, and by then the extension is gone and cannot report anything itself."
}

variable "waf_rate_limit" {
  type    = number
  default = 60
}

# --- the base both geo tiers inherit ---
#
# The function's own chain is two levels, device override on top of a complete tier set.
# These variables are the base the tier sets are merged onto in main.tf, and they exist
# only here: the function is handed the resolved TIER1_* and REST_* values and never
# sees a default of its own. Editing a number here moves both tiers at once.

# The US geo inference profile. Sonnet 5 has no bare on-demand model id on
# bedrock-runtime: a geo or global profile is required. The geo one keeps the IAM list
# in modules/api short (US and Canada regions) at a 10% premium over the global one.
# Any model named here or in a device override has to be in model_prices below and in
# the function's IAM policy, or the call is denied and the cost is logged as zero.
variable "default_model" {
  type    = string
  default = "us.anthropic.claude-sonnet-5"
}

variable "default_max_summary_tokens" {
  type    = number
  default = 400
}

variable "default_daily_quota" {
  type    = number
  default = 50
}

variable "tier1_countries" {
  type    = list(string)
  default = ["US", "CA", "GB", "DE", "FR", "NL", "SE", "NO", "DK", "FI", "CH", "AT", "IE", "BE", "AU", "NZ", "JP", "SG"]
}

variable "tier1" {
  type = object({
    model              = optional(string, "")
    max_summary_tokens = optional(number, 0)
    daily_quota        = optional(number, 0)
  })
  default     = {}
  description = "Overrides for tier 1 countries. A zero or empty field inherits the base above; either way the tier set handed to the function is complete."
}

variable "rest" {
  type = object({
    model              = optional(string, "")
    max_summary_tokens = optional(number, 0)
    daily_quota        = optional(number, 0)
  })
  default = {}
}

# USD per million tokens, keyed by model id. Cache reads and writes are priced
# separately because Bedrock bills them separately.
#
# These are Anthropic's list prices with the 10% that Bedrock adds for a geo (us.)
# profile over the global one, for Claude 4.5 and later: 2.00/10.00 list becomes
# 2.20/11.00. Cache write is 1.25x input, cache read 0.1x. Confirm against
# https://aws.amazon.com/bedrock/pricing/ when the prices change; the function only
# multiplies what it is given here.
#
# Haiku 4.5 stays priced because a device override can still name it.
variable "model_prices" {
  type = map(object({
    input      = number
    output     = number
    cacheRead  = number
    cacheWrite = number
  }))
  default = {
    "us.anthropic.claude-sonnet-5" = {
      input      = 2.20
      output     = 11.00
      cacheRead  = 0.22
      cacheWrite = 2.75
    }
    "us.anthropic.claude-haiku-4-5-20251001-v1:0" = {
      input      = 1.10
      output     = 5.50
      cacheRead  = 0.11
      cacheWrite = 1.375
    }
  }
}

# --- alarms ---

variable "alarm_email" {
  type = string
}

variable "daily_cost_alarm_usd" {
  type    = number
  default = 40
}

variable "min_invocations_for_alarm" {
  type        = number
  default     = 20
  description = "What counts as normal traffic for the zero-successes alarm. Without it the alarm is a night-time idle detector."
}

# --- telegram bot ---

variable "bot_version" {
  type        = string
  description = "Key of the bot artifact in S3, under bot/ and without the .zip. Same label as lambda_version when both halves came from one build."
}

variable "telegram_chat_ids" {
  type        = list(string)
  default     = []
  description = "Chats the bot will answer. Empty means it answers nobody and only replies with the chat id, which is how you find the first value to put here."
}

variable "bot_reserved_concurrency" {
  type        = number
  nullable    = true
  default     = null
  description = "Null for the same reason as reserved_concurrency above: the account ceiling is 10, and AWS rejects any reservation that leaves fewer than 10 unreserved. Set it to 2 once the ceiling is raised — the bot serves one person typing one command, and that is room for a retry rather than for a flood."
}
