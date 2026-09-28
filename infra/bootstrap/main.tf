# One-time setup, applied by hand with local credentials (local state, kept out of git):
#   - S3 bucket for the main stack's Terraform state
#   - GitHub Actions OIDC provider + deploy role (no long-lived AWS keys in CI)

provider "aws" {
  region              = var.region
  profile             = var.aws_profile
  allowed_account_ids = [var.account_id]

  default_tags {
    tags = { Project = var.project, ManagedBy = "terraform-bootstrap" }
  }
}

# ——— Terraform state ———

resource "aws_s3_bucket" "state" {
  bucket = "${var.project}-tfstate-${var.account_id}"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ——— GitHub Actions deploy role ———

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_policy_document" "deploy_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    # Only workflow runs on main in this repo can deploy.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["${var.github_sub_prefix}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name               = "${var.project}-deploy"
  assume_role_policy = data.aws_iam_policy_document.deploy_trust.json
}

# Scoped to this project's resources by name prefix where the service allows it.
data "aws_iam_policy_document" "deploy" {
  statement {
    sid       = "State"
    actions   = ["s3:ListBucket", "s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
  }
  statement {
    sid       = "ProjectBuckets"
    actions   = ["s3:*"]
    resources = ["arn:aws:s3:::${var.project}-*", "arn:aws:s3:::${var.project}-*/*"]
  }
  statement {
    sid       = "ProjectLambda"
    actions   = ["lambda:*"]
    resources = ["arn:aws:lambda:${var.region}:${var.account_id}:function:${var.project}-*"]
  }
  statement {
    sid       = "ProjectTables"
    actions   = ["dynamodb:*"]
    resources = ["arn:aws:dynamodb:${var.region}:${var.account_id}:table/${var.project}-*"]
  }
  statement {
    sid       = "ProjectParameters"
    actions   = ["ssm:*"]
    resources = ["arn:aws:ssm:${var.region}:${var.account_id}:parameter/${var.project}/*"]
  }
  statement {
    sid       = "ProjectLogs"
    actions   = ["logs:*"]
    resources = ["arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/lambda/${var.project}-*"]
  }
  statement {
    sid     = "ProjectRoles"
    actions = ["iam:*"]
    resources = [
      "arn:aws:iam::${var.account_id}:role/${var.project}-*",
      "arn:aws:iam::${var.account_id}:policy/${var.project}-*",
    ]
  }
  statement {
    # CloudFront, ACM and log-group listing don't support resource-level scoping for these calls.
    sid = "Unscoped"
    actions = [
      "cloudfront:*",
      "acm:*",
      "logs:DescribeLogGroups",
      "ssm:DescribeParameters",
      "sts:GetCallerIdentity",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "${var.project}-deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}
