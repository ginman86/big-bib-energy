variable "account_id" {
  description = "The only AWS account this may run against. Set in terraform.tfvars locally, TF_VAR_account_id in CI."
  type        = string
}

variable "aws_profile" {
  description = "Local AWS CLI profile (e.g. ginman). Leave null in CI, where OIDC credentials come from the environment."
  type        = string
  default     = null
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "project" {
  type    = string
  default = "big-bib-energy"
}

variable "domain" {
  description = "Site hostname. DNS is at Squarespace, so records are added there by hand (see outputs)."
  type        = string
  default     = "bigbib.ginman.dev"
}
