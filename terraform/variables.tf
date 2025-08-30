variable "cloudflare_account_id" {
  type        = string
  description = "Cloudflare Account ID"
}

variable "cloudflare_zone_id" {
  type        = string
  description = "Cloudflare Zone ID for your domain"
}

variable "domain_name" {
  type        = string
  description = "The domain name for email routing (e.g., fujiba.net)"
}
