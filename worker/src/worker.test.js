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
    expect(mockMessage.rejected).toBe('Address does not exist at this domain.') // ちゃんと拒否されているか
  })

  it('KVの値が無効なJSONの場合にメールを拒否すること', async () => {
    const kv = await mf.getKVNamespace('FORWARDING_LIST_KV')
    await kv.put('info@your-domain.com', 'invalid-json')

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

    expect(mockMessage.forwardedTo.length).toBe(0)
    expect(mockMessage.rejected).toBe('Configuration error: Invalid forwarding list format.')
  })

  it('KVの値が配列でない場合にメールを拒否すること', async () => {
    const kv = await mf.getKVNamespace('FORWARDING_LIST_KV')
    await kv.put('info@your-domain.com', JSON.stringify({ email: 'user@example.net' }))

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

    expect(mockMessage.forwardedTo.length).toBe(0)
    expect(mockMessage.rejected).toBe('Address does not exist.')
  })

  it('KVの値が空の配列の場合にメールを拒否すること', async () => {
    const kv = await mf.getKVNamespace('FORWARDING_LIST_KV')
    await kv.put('info@your-domain.com', JSON.stringify([]))

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

    expect(mockMessage.forwardedTo.length).toBe(0)
    // JSON.parseは成功するが、有効な配列形式ではないため 'Address does not exist.' が返される
    expect(mockMessage.rejected).toBe('Address does not exist.')
  })

  it('転送に失敗した場合にメールを拒否すること', async () => {
    const kv = await mf.getKVNamespace('FORWARDING_LIST_KV')
    const recipient = 'info@your-domain.com'
    const forwardingList = ['valid@example.com', 'invalid-unverified-address@example.com']
    await kv.put(recipient, JSON.stringify(forwardingList))

    const mockMessage = {
      to: recipient,
      forwardedTo: [],
      async forward(email) {
        if (email.includes('invalid')) {
          throw new Error('Failed to forward')
        }
        this.forwardedTo.push(email)
      },
      setReject(reason) {
        this.rejected = reason
      }
    }

    const env = await mf.getBindings()
    await worker.email(mockMessage, env)

    const expectedErrorMessage = `Failed to forward to one or more addresses for ${recipient}: Failed to forward`
    expect(mockMessage.rejected).toBe(expectedErrorMessage)
    // Promise.all は一つでも失敗すると全体が失敗するが、他のPromiseの実行はキャンセルされない。
    // そのため、`valid@example.com` へのforwardが成功し、`forwardedTo` に値が入る可能性がある。
    // 重要なのは、最終的に `rejected` が設定されること。
  })

  it('一部の転送には成功するが、全体としては失敗として扱われること', async () => {
    const kv = await mf.getKVNamespace('FORWARDING_LIST_KV')
    const recipient = 'info@your-domain.com'
    // 転送順序を制御するため、失敗するアドレスを先に配置
    const forwardingList = ['invalid-unverified-address@example.com', 'valid@example.com']
    await kv.put(recipient, JSON.stringify(forwardingList))

    const mockMessage = {
      to: recipient,
      forwardedTo: [],
      async forward(email) {
        // 実際のEmail Workerの挙動とは異なるが、テストのために同期的に記録
        this.forwardedTo.push(email)
        if (email.includes('invalid')) {
          throw new Error('Failed to forward')
        }
      },
      setReject(reason) {
        this.rejected = reason
      }
    }

    const env = await mf.getBindings()
    await worker.email(mockMessage, env)

    const expectedErrorMessage = `Failed to forward to one or more addresses for ${recipient}: Failed to forward`
    expect(mockMessage.rejected).toBe(expectedErrorMessage)
    // 'invalid'で例外がスローされる前に'valid'が処理される可能性があるため、
    // forwardedToに'valid'が含まれる場合があるが、最終的にrejectされることが重要。
    // このテストでは、rejectされることと、エラーメッセージが正しいことを主眼に置く
    expect(mockMessage.forwardedTo).toContain('valid@example.com')
  })
})
