terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # The state bucket is created outside this configuration on purpose: it has to
  # exist before the first plan can run.
  backend "s3" {
    bucket       = "mis-tfstate-501631673704"
    key          = "make-it-shorter/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}

# One region. ACM certificates and WAF with scope = CLOUDFRONT must live in
# us-east-1 anyway, and the region was chosen for Bedrock model availability.
provider "aws" {
  region = "us-east-1"

  default_tags {
    tags = {
      Project   = "make-it-shorter"
      ManagedBy = "terraform"
    }
  }
}
