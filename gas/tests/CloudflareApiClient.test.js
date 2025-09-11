import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CloudflareApiClient } from '../src/CloudflareApiClient.js'

describe('CloudflareApiClient', () => {
  let mockFetch
  let apiClient

  const mockConfig = {
    accountId: 'test-account-id',
    namespaceId: 'test-namespace-id',
    apiToken: 'test-api-token'
  }

  // 各テストの前にモックをセットアップ
  beforeEach(() => {
    // UrlFetchApp.fetchのレスポンスを模倣するモック関数
    mockFetch = vi.fn()
    apiClient = new CloudflareApiClient(mockConfig, mockFetch)
  })

  it('listKvKeysは正しいURLを呼び出し、キーを返す', () => {
    const mockResponse = {
      getResponseCode: () => 200,
      getContentText: () =>
        JSON.stringify({
          success: true,
          result: [{ name: 'key1' }, { name: 'key2' }]
        })
    }
    mockFetch.mockReturnValue(mockResponse)

    const keys = apiClient.listKvKeys()

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/test-account-id/storage/kv/namespaces/test-namespace-id/keys?limit=1000',
      expect.objectContaining({ method: 'get' })
    )
    expect(keys).toEqual(['key1', 'key2'])
  })

  it('deleteKvKeyは正しいURLを呼び出す', () => {
    const mockResponse = {
      getResponseCode: () => 200,
      getContentText: () => ''
    }
    mockFetch.mockReturnValue(mockResponse)

    const keyToDelete = 'group@example.com'
    apiClient.deleteKvKey(keyToDelete)

    expect(mockFetch).toHaveBeenCalledWith(
      `https://api.cloudflare.com/client/v4/accounts/test-account-id/storage/kv/namespaces/test-namespace-id/values/${encodeURIComponent(keyToDelete)}`,
      expect.objectContaining({ method: 'delete' })
    )
  })

  it('updateKvBulkは正しいペイロードを送信する', () => {
    const mockResponse = {
      getResponseCode: () => 200,
      getContentText: () => ''
    }
    mockFetch.mockReturnValue(mockResponse)

    const payload = [{ key: 'key1', value: 'value1' }]
    apiClient.updateKvBulk(payload)

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/test-account-id/storage/kv/namespaces/test-namespace-id/bulk',
      expect.objectContaining({
        method: 'put',
        payload: JSON.stringify(payload)
      })
    )
  })

  it('createDestinationAddressは正しいペイロードを送信し、成功を処理する', () => {
    const email = 'new@example.com'
    const mockResponse = {
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({ success: true })
    }
    mockFetch.mockReturnValue(mockResponse)

    const result = apiClient.createDestinationAddress(email)

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/test-account-id/email/routing/addresses',
      expect.objectContaining({
        method: 'post',
        payload: JSON.stringify({ email })
      })
    )
    expect(result.success).toBe(true)
  })

  it('getDestinationAddressesはページネーションを処理する', () => {
    // 1ページ目のレスポンス
    mockFetch.mockReturnValueOnce({
      getResponseCode: () => 200,
      getContentText: () =>
        JSON.stringify({
          success: true,
          result: [{ email: 'a@a.com', verified: true }],
          result_info: { page: 1, per_page: 1, total_count: 2, total_pages: 2 }
        })
    })
    // 2ページ目のレスポンス
    mockFetch.mockReturnValueOnce({
      getResponseCode: () => 200,
      getContentText: () =>
        JSON.stringify({
          success: true,
          result: [{ email: 'b@b.com', verified: false }],
          result_info: { page: 2, per_page: 1, total_count: 2, total_pages: 2 }
        })
    })

    const addresses = apiClient.getDestinationAddresses()

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(addresses).toEqual({
      verified: ['a@a.com'],
      pending: ['b@b.com']
    })
  })

  it('listRoutingRulesはページネーションを処理し、ルールをMapとして正しく返す', () => {
    // 1ページ目のレスポンス
    mockFetch.mockReturnValueOnce({
      getResponseCode: () => 200,
      getContentText: () =>
        JSON.stringify({
          success: true,
          result: [
            {
              matchers: [{ type: 'literal', field: 'to', value: 'rule1@example.com' }],
              actions: [{ type: 'forward', value: ['dest1@external.com'] }]
            }
          ],
          result_info: { page: 1, per_page: 1, total_count: 2, total_pages: 2 }
        })
    })
    // 2ページ目のレスポンス
    mockFetch.mockReturnValueOnce({
      getResponseCode: () => 200,
      getContentText: () =>
        JSON.stringify({
          success: true,
          result: [
            {
              matchers: [{ type: 'literal', field: 'to', value: 'rule2@example.com' }],
              actions: [{ type: 'forward', value: ['dest3@external.com', 'dest2@external.com'] }, { type: 'stop' }]
            }
          ],
          result_info: { page: 2, per_page: 1, total_count: 2, total_pages: 2 }
        })
    })

    const rules = apiClient.listRoutingRules()

    expect(mockFetch).toHaveBeenCalledTimes(2)
    const expectedMap = new Map()
    expectedMap.set('rule1@example.com', ['dest1@external.com'])
    expectedMap.set('rule2@example.com', ['dest2@external.com', 'dest3@external.com']) // The implementation sorts the destinations
    expect(rules).toEqual(expectedMap)
  })
})
