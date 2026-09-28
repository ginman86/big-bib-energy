# The API: one Go Lambda behind CloudFront at /api/*, plus its data.
# Build the binary before planning: see api/README.md (CI does this).

variable "strava_client_id" {
  description = "Strava API app client ID (public; also baked into the web build)."
  type        = string
  default     = ""
}

locals {
  api_name = "${var.project}-api"
}

data "archive_file" "api" {
  type        = "zip"
  source_file = "${path.module}/../../api/dist/bootstrap"
  output_path = "${path.module}/../../api/dist/api.zip"
}

# ——— Data ———

resource "aws_dynamodb_table" "main" {
  name         = "${var.project}-main"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }

  # Sessions expire on their own.
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }
}

resource "aws_s3_bucket" "fit" {
  bucket = "${var.project}-fit-${var.account_id}"
}

resource "aws_s3_bucket_public_access_block" "fit" {
  bucket                  = aws_s3_bucket.fit.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "fit" {
  bucket = aws_s3_bucket.fit.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# The value is set once by hand, so the secret never lands in Terraform state:
#   aws ssm put-parameter --name /big-bib-energy/strava-client-secret --type SecureString \
#     --overwrite --value '<secret>' --profile ginman --region us-east-1
resource "aws_ssm_parameter" "strava_client_secret" {
  name  = "/${var.project}/strava-client-secret"
  type  = "SecureString"
  value = "set-me-with-the-aws-cli"

  lifecycle {
    ignore_changes = [value]
  }
}

# ——— Lambda ———

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${local.api_name}"
  retention_in_days = 14
}

data "aws_iam_policy_document" "api_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "api" {
  name               = local.api_name
  assume_role_policy = data.aws_iam_policy_document.api_assume.json
}

data "aws_iam_policy_document" "api" {
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.api.arn}:*"]
  }
  statement {
    actions = [
      "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem",
      "dynamodb:Query", "dynamodb:BatchWriteItem",
    ]
    resources = [aws_dynamodb_table.main.arn]
  }
  statement {
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.fit.arn}/*"]
  }
  statement {
    actions   = ["ssm:GetParameter"]
    resources = [aws_ssm_parameter.strava_client_secret.arn]
  }
  statement {
    # SecureString uses the AWS-managed aws/ssm key.
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "api" {
  name   = local.api_name
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api.json
}

resource "aws_lambda_function" "api" {
  function_name    = local.api_name
  role             = aws_iam_role.api.arn
  runtime          = "provided.al2023"
  architectures    = ["arm64"]
  handler          = "bootstrap"
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256
  memory_size      = 256
  timeout          = 30 # Strava uploads poll for a few seconds

  # No reserved concurrency: this account's limit is 10 total, and AWS requires 10 to stay
  # unreserved. That limit caps concurrency anyway, and the URL is reachable only via CloudFront.

  environment {
    variables = {
      TABLE               = aws_dynamodb_table.main.name
      FIT_BUCKET          = aws_s3_bucket.fit.bucket
      STRAVA_CLIENT_ID    = var.strava_client_id
      STRAVA_SECRET_PARAM = aws_ssm_parameter.strava_client_secret.name
      SITE_ORIGIN         = "https://${var.domain}"
      VERSION             = data.archive_file.api.output_base64sha256
    }
  }

  depends_on = [aws_cloudwatch_log_group.api]
}

# IAM-authenticated: only CloudFront (signing with OAC) can invoke it.
resource "aws_lambda_function_url" "api" {
  function_name      = aws_lambda_function.api.function_name
  authorization_type = "AWS_IAM"
}

resource "aws_cloudfront_origin_access_control" "api" {
  name                              = "${var.project}-api"
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Function URLs behind OAC need both permissions for the CloudFront service principal.
resource "aws_lambda_permission" "cloudfront_url" {
  statement_id  = "AllowCloudFrontInvokeFunctionUrl"
  action        = "lambda:InvokeFunctionUrl"
  function_name = aws_lambda_function.api.function_name
  principal     = "cloudfront.amazonaws.com"
  source_arn    = aws_cloudfront_distribution.site.arn
}

resource "aws_lambda_permission" "cloudfront_invoke" {
  statement_id  = "AllowCloudFrontInvokeFunction"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "cloudfront.amazonaws.com"
  source_arn    = aws_cloudfront_distribution.site.arn
}
