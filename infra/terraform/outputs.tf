output "api_endpoint" {
  value = "https://${local.api_domain}/v1/shorten"
}

output "function_name" {
  value = module.api.function_name
}

output "function_url" {
  description = "Direct Function URL. Signed SigV4 calls only; the WAF and the custom domain are in front of it."
  value       = module.api.function_url
}

output "table_name" {
  value = module.data.table_name
}

output "artifacts_bucket" {
  value = module.artifacts.bucket_name
}

output "landing_url" {
  value = "https://${var.domain}"
}

output "bot_webhook_url" {
  description = "Hand this to Telegram's setWebhook, together with the secret_token from the mis-bot secret."
  value       = module.bot.webhook_url
}

output "bot_secret_arn" {
  description = "Where the bot token and webhook secret go. Terraform creates the secret and never sees its contents."
  value       = module.bot.secret_arn
}
