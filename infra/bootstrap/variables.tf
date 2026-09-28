variable "account_id" {
  description = "The only AWS account this may run against (personal account, never work). Set in terraform.tfvars."
  type        = string
}

variable "aws_profile" {
  description = "Local AWS CLI profile. Bootstrap is only ever applied by hand."
  type        = string
  default     = "ginman"
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "project" {
  type    = string
  default = "big-bib-energy"
}

variable "github_sub_prefix" {
  description = <<-EOT
    OIDC subject prefix for this repo. It uses GitHub's immutable subject format (owner and repo
    IDs), so a renamed or re-created repo with the same name can't assume the role. Look it up with:
      gh api repos/<owner>/<repo>/actions/oidc/customization/sub --jq .sub_claim_prefix
  EOT
  type        = string
  default     = "repo:ginman86@3515076/big-bib-energy@1386253641"
}
