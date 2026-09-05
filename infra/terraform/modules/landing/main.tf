variable "domain" { type = string }
variable "zone_id" { type = string }
variable "content_root" { type = string }
variable "logs_enabled" { type = bool }
variable "log_retention_days" { type = number }

resource "aws_s3_bucket" "landing" {
  bucket = "mis-landing"
}

resource "aws_s3_bucket_public_access_block" "landing" {
  bucket                  = aws_s3_bucket.landing.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_acm_certificate" "landing" {
  domain_name       = var.domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for option in aws_acm_certificate.landing.domain_validation_options :
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

resource "aws_acm_certificate_validation" "landing" {
  certificate_arn         = aws_acm_certificate.landing.arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
}

resource "aws_cloudfront_origin_access_control" "landing" {
  name                              = "mis-landing-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# CloudFront does not serve index.html for a subdirectory on its own, so /welcome
# would return 403 — and that would be discovered exactly when the first user
# installs the extension.
resource "aws_cloudfront_function" "index_rewrite" {
  name    = "mis-landing-index-rewrite"
  runtime = "cloudfront-js-2.0"
  publish = true

  code = <<-JS
    function handler(event) {
      var request = event.request;
      if (request.uri.endsWith('/')) {
        request.uri += 'index.html';
      } else if (!request.uri.includes('.')) {
        request.uri += '/index.html';
      }
      return request;
    }
  JS
}

resource "aws_cloudfront_distribution" "landing" {
  enabled             = true
  comment             = "mis-landing"
  aliases             = [var.domain]
  is_ipv6_enabled     = true
  default_root_object = "index.html"

  origin {
    domain_name              = aws_s3_bucket.landing.bucket_regional_domain_name
    origin_id                = "landing-bucket"
    origin_access_control_id = aws_cloudfront_origin_access_control.landing.id
  }

  default_cache_behavior {
    target_origin_id       = "landing-bucket"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]

    # Managed-CachingOptimized. The query string is deliberately not part of the
    # cache key: /rate-us?stars=3 and ?stars=5 are the same file, and the value is
    # read by JavaScript on the client.
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.index_rewrite.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.landing.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

data "aws_iam_policy_document" "landing" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.landing.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.landing.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "landing" {
  bucket = aws_s3_bucket.landing.id
  policy = data.aws_iam_policy_document.landing.json
}

# The service pages. The landing page itself is a separate piece of work; these
# three are what the extension links to.
resource "aws_s3_object" "pages" {
  for_each = toset(["welcome", "uninstall", "rate-us"])

  bucket = aws_s3_bucket.landing.id
  key    = "${each.value}/index.html"
  source = "${var.content_root}/${each.value}/index.html"
  etag   = filemd5("${var.content_root}/${each.value}/index.html")

  content_type = "text/html"
  # Five minutes, so an edit to /welcome reaches users without an invalidation.
  cache_control = "public, max-age=300"
}

resource "aws_route53_record" "landing" {
  for_each = toset(["A", "AAAA"])

  zone_id = var.zone_id
  name    = var.domain
  type    = each.value

  alias {
    name                   = aws_cloudfront_distribution.landing.domain_name
    zone_id                = aws_cloudfront_distribution.landing.hosted_zone_id
    evaluate_target_health = false
  }
}

output "distribution_id" { value = aws_cloudfront_distribution.landing.id }
output "bucket_name" { value = aws_s3_bucket.landing.id }

# --- access logs ---
#
# What this is for: /uninstall is where Chrome sends someone who has just removed the
# extension, and a request to it is the only trace that they did. How many, from where,
# and when is a question these logs answer and nothing else does — the extension is gone
# by then and cannot report anything itself, and the redirect target is a Google form
# that counts submissions rather than arrivals.
#
# Standard logging v2 to CloudWatch Logs, the same shape the API distribution uses. The
# field list is spelled out rather than left to the default because the default is the
# classic 33-column set, and the field that carries the country is not in it.
resource "aws_cloudwatch_log_group" "landing" {
  count = var.logs_enabled ? 1 : 0

  name              = "/aws/cloudfront/mis-landing"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_delivery_source" "landing" {
  count = var.logs_enabled ? 1 : 0

  name         = "mis-landing-access-logs"
  log_type     = "ACCESS_LOGS"
  resource_arn = aws_cloudfront_distribution.landing.arn
}

resource "aws_cloudwatch_log_delivery_destination" "landing" {
  count = var.logs_enabled ? 1 : 0

  name          = "mis-landing-access-logs"
  output_format = "json"

  delivery_destination_configuration {
    destination_resource_arn = aws_cloudwatch_log_group.landing[0].arn
  }
}

resource "aws_cloudwatch_log_delivery" "landing" {
  count = var.logs_enabled ? 1 : 0

  delivery_source_name     = aws_cloudwatch_log_delivery_source.landing[0].name
  delivery_destination_arn = aws_cloudwatch_log_delivery_destination.landing[0].arn

  # Deliberately short. Every extra column is bytes per request forever, and this log
  # exists to answer three questions: how many, from where, when.
  record_fields = [
    "timestamp",
    "c-country",
    "cs-uri-stem",
    "sc-status",
    "cs(User-Agent)",
    "cs(Referer)",
    "x-edge-result-type",
  ]
}

output "log_group_name" {
  value = var.logs_enabled ? aws_cloudwatch_log_group.landing[0].name : ""
}
