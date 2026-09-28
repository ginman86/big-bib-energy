# Two DNS records are added by hand at Squarespace (ginman.dev). Hosts are relative to ginman.dev.

output "dns_1_certificate_validation" {
  description = "Step 1: add, and keep permanently (ACM re-checks it for auto-renewal)."
  value = [for o in aws_acm_certificate.site.domain_validation_options : {
    type = o.resource_record_type
    host = trimsuffix(o.resource_record_name, ".ginman.dev.")
    data = o.resource_record_value
  }]
}

output "dns_2_site" {
  description = "Step 2: point the site hostname at CloudFront."
  value = {
    type = "CNAME"
    host = trimsuffix(var.domain, ".ginman.dev")
    data = aws_cloudfront_distribution.site.domain_name
  }
}

output "site_bucket" {
  value = aws_s3_bucket.site.bucket
}

output "distribution_id" {
  value = aws_cloudfront_distribution.site.id
}

output "url" {
  value = "https://${var.domain}"
}
