variable "domain" {
  type    = string
  default = "make-it-shorter.net"
}

variable "artifacts_bucket" {
  type    = string
  default = "mis-artifacts"
}

# The build to run, as the short git sha printed by make-release.sh. Deploying is
# changing this value; rolling back is changing it back.
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

variable "languages" {
  type = list(string)
  default = [
    "en", "ru", "de", "fr", "es", "it", "nl", "pl", "tr", "uk",
    "cs", "sv", "da", "fi", "nb", "ro", "hu", "el", "bg", "sk",
    "he", "ar", "hi", "id", "vi", "th", "ja", "ko", "zh-Hans", "zh-Hant",
    "pt-BR", "pt-PT",
  ]
}

variable "max_actions" {
  type        = number
  default     = 5
  description = "Global ceiling, and the multiplier on request cost: every button is one more model call. It goes into the prompt, which sits before the first cache breakpoint and so must be identical across requests, so no tier may exceed it. The tool schema cannot carry maxItems at all — Bedrock rejects it alongside strict."
}

variable "answer_timeout_seconds" {
  type    = number
  default = 25
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
  description = "Counted against Bedrock, not Lambda: one client request is up to six model calls, five of them at once. Null while the account ceiling is 10 — AWS rejects any reservation that leaves fewer than 10 unreserved, so the account limit binds tighter than the reservation would."
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

variable "default_max_answer_tokens" {
  type    = number
  default = 250
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
    max_answer_tokens  = optional(number, 0)
    max_actions        = optional(number, 0)
    daily_quota        = optional(number, 0)
  })
  default     = {}
  description = "Overrides for tier 1 countries. A zero or empty field inherits the base above; either way the tier set handed to the function is complete."
}

variable "rest" {
  type = object({
    model              = optional(string, "")
    max_summary_tokens = optional(number, 0)
    max_answer_tokens  = optional(number, 0)
    max_actions        = optional(number, 0)
    daily_quota        = optional(number, 0)
  })
  default = {}
}

# USD per million tokens, keyed by model id. Cache reads are priced separately on
# purpose: with pre-generated answers most of the input is read from cache, and
# without that price the cost estimate is several times too high.
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
