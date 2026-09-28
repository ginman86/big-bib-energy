terraform {
  # 1.10+ for S3-native state locking (use_lockfile) in the main stack.
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.66"
    }
  }
}
