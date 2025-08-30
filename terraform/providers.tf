terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.8"
    }
  }
}

# Cloudflare Providerの設定
# APIトークンは環境変数 `CLOUDFLARE_API_TOKEN` から読み込まれます
provider "cloudflare" {}
