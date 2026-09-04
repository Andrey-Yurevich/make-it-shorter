variable "api_domain" { type = string }
variable "zone_id" { type = string }
variable "function_url" { type = string }
variable "function_name" { type = string }
variable "waf_rate_limit" { type = number }
variable "log_retention_days" { type = number }
variable "waf_logs_enabled" { type = bool }
variable "cloudfront_logs_enabled" { type = bool }

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

  # Only a Chrome extension may call the API. This rule needs no path exceptions
  # because every endpoint is POST, and browsers always set Origin on POST.
  #
  # Any extension, not one specific id. What this rule actually buys is the exclusion of
  # web pages: the browser sets Origin itself from the page it runs on, and no script can
  # forge it, so the API cannot be embedded in a site. Naming one id on top of that
  # bought less than it looked like — an unpacked build derives its id from the absolute
  # path of its folder, so every development machine is a different extension, while a
  # scripted client sends whatever Origin it likes and the store id is public anyway.
  #
  # So the id check turned dev machines away and let determined callers through. It is
  # gone, and the extension_id variable with it: a knob that no longer moves anything is
  # worse than no knob. Pinning identity properly is EXTENSION_KEY in the manifest, which
  # gives every build one stable id; when that lands, this can go back to a list of them.
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
            positional_constraint = "STARTS_WITH"
            search_string         = "chrome-extension://"

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

        # SizeRestrictions_BODY blocks any body over 8 KB, and this API exists to receive
        # long text: 30 000 code points is up to ~90 KB on Cyrillic or CJK, so every
        # compression of a real page would be refused at the edge. The viewer sees
        # CloudFront's own "Request blocked" page, which names neither the rule nor a size.
        #
        # Counted rather than removed, so the hits still show up in metrics. The real gate
        # on input size is the function's own MIN_INPUT/MAX_INPUT check, measured in code
        # points and answering with a code the extension can show. The rest of the group
        # keeps its blocking action; only the size cap is lifted.
        rule_action_override {
          name = "SizeRestrictions_BODY"
          action_to_use {
            count {}
          }
        }
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

# --- WAF logs ---
#
# The WebACL counts what it blocks in metrics, but a count cannot say which rule fired
# or how often, and that is the only question worth asking when the extension suddenly
# stops working. These logs answer it.

# The name is not a preference: WAF refuses any CloudWatch destination whose log group
# is not named aws-waf-logs-*, and the error it gives says nothing about the prefix.
resource "aws_cloudwatch_log_group" "waf" {
  name              = "aws-waf-logs-mis-api"
  retention_in_days = var.log_retention_days
}

resource "aws_wafv2_web_acl_logging_configuration" "api" {
  count = var.waf_logs_enabled ? 1 : 0

  resource_arn = aws_wafv2_web_acl.api.arn

  # The log group ARN carries a trailing ":*" that WAF rejects.
  log_destination_configs = [trimsuffix(aws_cloudwatch_log_group.waf.arn, ":*")]

  # Allowed requests are dropped before they are written. Every question the report asks
  # is about requests that were stopped or counted, and on a working service those are a
  # rounding error next to the traffic that goes through — logging all of it would be
  # paying per gigabyte to store the answer "nothing happened".
  logging_filter {
    default_behavior = "DROP"

    filter {
      behavior    = "KEEP"
      requirement = "MEETS_ANY"

      condition {
        action_condition {
          action = "BLOCK"
        }
      }

      condition {
        action_condition {
          action = "COUNT"
        }
      }
    }
  }

  # WAF writes the request headers, and X-Device-Id is one of them. The device id is not
  # in the allow-list of things this service logs, and it has no business being in a log
  # group that exists to count rule hits: redacted here, at the only place it could leak.
  redacted_fields {
    single_header {
      name = "x-device-id"
    }
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

# Two statements are required, not one, and this is the one that is easy to miss: with
# only InvokeFunctionUrl above, CloudFront's signed request is denied and the viewer gets
# the Function URL's own 403 with AccessDeniedException. Nothing in that error points at a
# missing permission — the distribution, the OAC and the signature are all fine — so the
# hours go into the signature instead. AWS documents both calls side by side under
# "Restrict access to an AWS Lambda function URL origin".
resource "aws_lambda_permission" "cloudfront_invoke" {
  statement_id  = "AllowCloudFrontInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.function_name
  principal     = "cloudfront.amazonaws.com"
  source_arn    = aws_cloudfront_distribution.api.arn
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
# Empty when logging is off, and that is the point: the reporter reads this to decide
# between "nothing was blocked" and "nobody was counting". A name that stayed valid while
# the delivery was switched off would turn the second into the first.
output "waf_log_group_name" {
  value = var.waf_logs_enabled ? aws_cloudwatch_log_group.waf.name : ""
}

output "cloudfront_log_group_name" {
  value = var.cloudfront_logs_enabled ? aws_cloudwatch_log_group.cloudfront[0].name : ""
}
output "distribution_domain" { value = aws_cloudfront_distribution.api.domain_name }

# --- CloudFront access logs ---
#
# Standard logging v2, delivered to CloudWatch Logs. Not the distribution's own
# logging_config block: that one writes to S3 and needs a bucket with ACLs enabled, which
# is off by default on every bucket made this decade and is the wrong thing to turn back
# on for a log nobody reads from S3 anyway.
#
# WAF logs say what was stopped. These say what arrived — every request, allowed ones
# included, which is the difference and also the cost: they are billed per gigabyte
# ingested, and unlike the WAF group there is no filter narrowing them. Hence the toggle.
resource "aws_cloudwatch_log_group" "cloudfront" {
  count = var.cloudfront_logs_enabled ? 1 : 0

  name              = "/aws/cloudfront/mis-api"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_delivery_source" "cloudfront" {
  count = var.cloudfront_logs_enabled ? 1 : 0

  name         = "mis-api-access-logs"
  log_type     = "ACCESS_LOGS"
  resource_arn = aws_cloudfront_distribution.api.arn
}

resource "aws_cloudwatch_log_delivery_destination" "cloudfront" {
  count = var.cloudfront_logs_enabled ? 1 : 0

  name          = "mis-api-access-logs"
  output_format = "json"

  delivery_destination_configuration {
    destination_resource_arn = aws_cloudwatch_log_group.cloudfront[0].arn
  }
}

resource "aws_cloudwatch_log_delivery" "cloudfront" {
  count = var.cloudfront_logs_enabled ? 1 : 0

  delivery_source_name     = aws_cloudwatch_log_delivery_source.cloudfront[0].name
  delivery_destination_arn = aws_cloudwatch_log_delivery_destination.cloudfront[0].arn
}
