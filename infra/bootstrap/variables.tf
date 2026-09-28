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

variable "github_repo" {
  description = "owner/name allowed to assume the deploy role from GitHub Actions."
  type        = string
  default     = "ginman86/big-bib-energy"
}
