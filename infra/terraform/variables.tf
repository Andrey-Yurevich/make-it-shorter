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

variable "extension_id" {
  type        = string
  description = "Chrome extension id. The WAF only lets chrome-extension://<id> through."
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
  default = 50
}

variable "max_input" {
  type    = number
  default = 30000
}

# The output languages the service serves, and the server side of the pair: the
# extension's SUMMARY_LANGS is a copy of this list and must never be wider than it, or
# it offers a language answered with unsupported_language.
#
# The line the list is drawn on is where the model stops being reliable rather than
# where speakers run out: a summary in a language it half-knows is worse than none.
# Variants are split only where the texts genuinely differ — Portuguese and Chinese.
# Serbian is not split by script, and neither is any regional English or Spanish.
variable "languages" {
  type = list(string)
  default = [
    # western Europe
    "en", "es", "pt-BR", "pt-PT", "fr", "de", "it", "nl", "ca", "gl",
    # the Nordics
    "sv", "da", "nb", "fi", "is",
    # central, eastern and southeastern Europe
    "pl", "cs", "sk", "sl", "hr", "sr", "bg", "ro", "hu", "el", "sq", "mk",
    # eastern Europe and the Baltics
    "ru", "uk", "be", "lt", "lv", "et",
    # the Caucasus and central Asia
    "ka", "hy", "az", "kk", "uz",
    # the Middle East
    "tr", "he", "ar", "fa", "ur",
    # south Asia
    "hi", "bn", "pa", "gu", "mr", "ta", "te", "kn", "ml",
    # southeast Asia
    "th", "vi", "id", "ms", "tl",
    # east Asia
    "zh-Hans", "zh-Hant", "ja", "ko",
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

variable "default_model" {
  type    = string
  default = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
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
# separately because Bedrock bills them separately; both are near zero today, since the
# only static part of the prompt is too short to be cached at all.
variable "model_prices" {
  type = map(object({
    input      = number
    output     = number
    cacheRead  = number
    cacheWrite = number
  }))
  default = {
    "us.anthropic.claude-haiku-4-5-20251001-v1:0" = {
      input      = 1.00
      output     = 5.00
      cacheRead  = 0.10
      cacheWrite = 1.25
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
