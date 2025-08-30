# メール転送リストを保存するKV Namespaceを作成
resource "cloudflare_workers_kv_namespace" "forwarding_list" {
  account_id = var.cloudflare_account_id
  title      = "Email-Forwarding-List"
}

# Email Worker スクリプトをアップロード
resource "cloudflare_workers_script" "email_forwarder" {
  account_id        = var.cloudflare_account_id
  script_name       = "email-forwarder-worker"
  content           = file("${path.module}/../worker/src/worker.js")
  main_module       = "worker.js"

  # WorkerにKV Namespaceをバインドする
  # これにより、worker.js内の `env.FORWARDING_LIST_KV` でアクセス可能になる
  bindings  = [
    {
        name         = "FORWARDING_LIST_KV"
        type         = "kv_namespace"
        namespace_id = cloudflare_workers_kv_namespace.forwarding_list.id
    }
  ]
  observability = {
    enabled = true
    head_sampling_rate = 1
    logs = {
      enabled = true
      head_sampling_rate = 1
      invocation_logs = true
    }
  }
}

# Email Routingのルールを作成
# 指定したドメイン宛のすべてのメールをWorkerに送る (キャッチオール)
resource "cloudflare_email_routing_catch_all" "example_email_routing_catch_all" {
  zone_id = var.cloudflare_zone_id
  actions = [{
    type = "worker"
    value = [cloudflare_workers_script.email_forwarder.script_name]
  }]
  matchers = [{
    type = "all"
  }]
  enabled = true
  name = "Send to catch all this domain rule."
}
