terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.66"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }

  # Partial config: pass the bucket at init, e.g.
  #   terraform init -backend-config="bucket=big-bib-energy-tfstate-<account_id>"
  backend "s3" {
    key          = "main.tfstate"
    region       = "us-east-1"
    use_lockfile = true
    encrypt      = true
  }
}
