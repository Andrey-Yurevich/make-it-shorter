variable "api_domain" { type = string }
variable "zone_id" { type = string }
variable "function_url" { type = string }
variable "function_name" { type = string }
variable "extension_id" { type = string }
variable "waf_rate_limit" { type = number }

locals {
  origin_host = replace(replace(var.function_url, "https://", ""), "/", "")
  origin_id   = "lambda-function-url"
}

resource "aws_acm_certificate" "api" {
  domain_name       = var.api_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for option in aws_acm_certificate.api.domain_validation_options :
    option.domain_name => {
      name   = option.resource_record_name
      record = option.resource_record_value
      type   = option.resource_record_type
    }
  }

  zone_id         = var.zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "api" {
  certificate_arn         = aws_acm_certificate.api.arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
}

# Without OAC the Function URL is reachable directly, bypassing the WAF entirely.
resource "aws_cloudfront_origin_access_control" "api" {
  name                              = "mis-api-oac"
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Only the headers the function actually reads. CloudFront-Viewer-Country is what
# lets the function pick a geo tier without ever seeing an IP address.
#
# x-amz-content-sha256 is deliberately absent: CloudFront rejects it in a
# forwarding list ("The parameter Headers contains x-amz-content-sha256 that is
# not allowed") because it owns that header as part of OAC's SigV4 signing. The
# client must still send it — CloudFront reads it to build the signature — but it
# is not something this policy forwards, and the function never reads it.
resource "aws_cloudfront_origin_request_policy" "api" {
  name = "mis-api-origin-request"

  headers_config {
    header_behavior = "whitelist"
    headers {
      items = [
        "X-Device-Id",
        "X-Catalog-Version",
        "Origin",
        "Content-Type",
        "CloudFront-Viewer-Country",
      ]
    }
  }

  cookies_config {
    cookie_behavior = "none"
  }

  query_strings_config {
    query_string_behavior = "none"
  }
}

resource "aws_wafv2_web_acl" "api" {
  name  = "mis-api"
  scope = "CLOUDFRONT"

  default_action {
    allow {}
  }

  # Only the extension may call the API. This rule needs no path exceptions
  # because every endpoint is POST, and browsers always set Origin on POST.
  rule {
    name     = "origin-must-be-the-extension"
    priority = 1

    action {
      block {}
    }

    statement {
      not_statement {
        statement {
          byte_match_statement {
            positional_constraint = "EXACTLY"
            search_string         = "chrome-extension://${var.extension_id}"

            field_to_match {
              single_header {
                name = "origin"
              }
            }

            text_transformation {
              priority = 0
              type     = "NONE"
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "mis-origin"
      sampled_requests_enabled   = true
    }
  }

  # Deliberately low: the extension is used at home and on the move, not behind
  # an office NAT shared by a hundred people.
  rule {
    name     = "rate-limit-per-ip"
    priority = 2

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit                 = var.waf_rate_limit
        evaluation_window_sec = 300
        aggregate_key_type    = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "mis-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "common-rule-set"
    priority = 3

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "mis-common"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "mis-api-waf"
    sampled_requests_enabled   = true
  }
}

resource "aws_cloudfront_distribution" "api" {
  enabled         = true
  comment         = "mis-api"
  aliases         = [var.api_domain]
  is_ipv6_enabled = true
  web_acl_id      = aws_wafv2_web_acl.api.arn

  origin {
    domain_name              = local.origin_host
    origin_id                = local.origin_id
    origin_access_control_id = aws_cloudfront_origin_access_control.api.id

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]

      # Must outlast the function's own 50s timeout, or CloudFront wins the race
      # on a long answer and the reader gets a broken connection instead of a
      # summary that was nearly finished. 60 is the ceiling without a quota request.
      origin_read_timeout = 60
    }
  }

  default_cache_behavior {
    target_origin_id       = local.origin_id
    viewer_protocol_policy = "https-only"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]

    # Managed-CachingDisabled: responses are streaming and personal.
    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    origin_request_policy_id = aws_cloudfront_origin_request_policy.api.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.api.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

# Lives here rather than in the api module because it needs the distribution ARN,
# and the api module is what the cdn module is built on top of — putting it there
# would make the two modules depend on each other.
resource "aws_lambda_permission" "cloudfront" {
  statement_id           = "AllowCloudFront"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = var.function_name
  principal              = "cloudfront.amazonaws.com"
  source_arn             = aws_cloudfront_distribution.api.arn
  function_url_auth_type = "AWS_IAM"
}

resource "aws_route53_record" "api" {
  for_each = toset(["A", "AAAA"])

  zone_id = var.zone_id
  name    = var.api_domain
  type    = each.value

  alias {
    name                   = aws_cloudfront_distribution.api.domain_name
    zone_id                = aws_cloudfront_distribution.api.hosted_zone_id
    evaluate_target_health = false
  }
}

output "distribution_arn" { value = aws_cloudfront_distribution.api.arn }
output "distribution_domain" { value = aws_cloudfront_distribution.api.domain_name }
