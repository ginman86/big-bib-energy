# Infrastructure

AWS, managed with Terraform, in the personal account only: both stacks set
`allowed_account_ids`, so they refuse to run against any other account. The account ID isn't
committed; it comes from `terraform.tfvars` (gitignored) locally and the `AWS_ACCOUNT_ID` repo
variable in CI.

- `bootstrap/`: applied **once, by hand**. Creates the Terraform state bucket and the GitHub
  Actions OIDC deploy role. Local state (keep `bootstrap/terraform.tfstate` somewhere safe).
- `main/`: everything else (certificate, CloudFront, site bucket; the API later). Applied by CI
  on every push to `main`, with state in S3.

## First-time setup

Prereqs: `brew install terraform` (from `hashicorp/tap` if needed) and the `ginman` AWS profile.

```sh
export AWS_PROFILE=ginman

# 1. Bootstrap: state bucket + deploy role
cd infra/bootstrap
cp terraform.tfvars.example terraform.tfvars   # set account_id
terraform init && terraform apply
# → outputs state_bucket, deploy_role_arn

# 2. Certificate first: CloudFront can't be created until it's validated
cd ../main
cp terraform.tfvars.example terraform.tfvars   # set account_id
terraform init -backend-config="bucket=<state_bucket>"
terraform apply -target=aws_acm_certificate.site
terraform output dns_1_certificate_validation
```

3. In **Squarespace → Domains → ginman.dev → DNS → Custom records**, add that CNAME
   (host, type `CNAME`, data). Keep it permanently: ACM re-checks it to auto-renew.

```sh
# 4. Everything else (waits until ACM sees the record, usually a few minutes)
terraform apply
terraform output dns_2_site
```

5. Add that second CNAME at Squarespace: host `bigbib` → the `dxxxx.cloudfront.net` value.

6. GitHub repo **variables** (Settings → Secrets and variables → Actions → Variables):

   | Variable | Value |
   |---|---|
   | `AWS_ACCOUNT_ID` | the account ID |
   | `AWS_DEPLOY_ROLE_ARN` | `deploy_role_arn` from bootstrap |
   | `TF_STATE_BUCKET` | `state_bucket` from bootstrap |

   None of these are secrets. The OIDC role only trusts workflow runs on `main` in this repo.

7. Merge to `main` → the workflow applies Terraform, uploads the site, and invalidates
   `index.html`. Then turn off GitHub Pages (Settings → Pages → Unpublish, or
   `gh api -X DELETE repos/ginman86/big-bib-energy/pages`).

## Notes

- **Caching:** `assets/*` are content-hashed, so they're immutable for a year. `index.html` is
  `no-cache`. Other `public/` files are cached for an hour.
- **Security headers** (CloudFront response headers policy): CSP limited to self plus Google
  Fonts, HSTS (preload), `nosniff`, `frame-ancestors 'none'`, and a Permissions-Policy allowing
  Bluetooth only on our own origin.
- **Cost:** within free tiers (CloudFront 1 TB/month, S3 pennies). No Route 53: DNS stays at
  Squarespace.
