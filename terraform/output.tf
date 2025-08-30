output "kv_namespace_id" {
  value       = cloudflare_workers_kv_namespace.forwarding_list.id
  description = "The ID of the KV namespace for email forwarding."
}

output "worker_name" {
  value       = cloudflare_workers_script.email_forwarder.script_name
  description = "The name of the deployed email worker."
}
