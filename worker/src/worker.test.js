import { Miniflare } from 'miniflare'
import { describe, it, expect, beforeEach } from 'vitest'
import worker from './worker.js'

describe('Email Forwarder Worker Tests', () => {
  let mf

  // 各テストの前にMiniflareの環境をセットアップ
  beforeEach(() => {
    mf = new Miniflare({
      modules: true,
      // KVなどの環境をモックするため、ワーカー自体は空のモジュールを指定
      script: 'export default {}',
      kvNamespaces: ['FORWARDING_LIST_KV']
    })
  })

  it('KVに存在するアドレス宛のメールを正しく転送すること', async () => {
    const kv = await mf.getKVNamespace('FORWARDING_LIST_KV')
    const forwardingList = ['user1@example.net', 'user2@example.net']
    await kv.put('info@your-domain.com', JSON.stringify(forwardingList))

    const mockMessage = {
      to: 'info@your-domain.com',
      forwardedTo: [],
      async forward(email) {
        this.forwardedTo.push(email)
      },
      setReject(reason) {
        this.rejected = reason
      }
    }

    const env = await mf.getBindings()
    await worker.email(mockMessage, env)

    expect(mockMessage.forwardedTo).toEqual(forwardingList) // 正しいアドレスに転送されたか
    expect(mockMessage.rejected).toBeUndefined() // 拒否されていないこと
  })

  it('KVに存在しないアドレス宛のメールを拒否すること', async () => {
    const mockMessage = {
      to: 'unknown@your-domain.com',
      forwardedTo: [],
      async forward(email) {
        this.forwardedTo.push(email)
      },
      setReject(reason) {
        this.rejected = reason
      }
    }

    const env = await mf.getBindings()
    await worker.email(mockMessage, env)

    expect(mockMessage.forwardedTo.length).toBe(0) // 誰も転送されていないこと
    expect(mockMessage.rejected).toBeDefined() // ちゃんと拒否されているか
  })
})
