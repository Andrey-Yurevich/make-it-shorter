output "api_endpoint" {
  value = "https://${local.api_domain}/v1/summarize"
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
