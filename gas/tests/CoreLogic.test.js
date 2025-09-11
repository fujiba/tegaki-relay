import { describe, it, expect } from 'vitest'
import {
  processForwardingData,
  determineKeysToDelete,
  resolveAndFlattenDestinations,
  reconcileRules
} from '../src/CoreLogic.js'

describe('processForwardingData', () => {
  const mockConfig = { domainName: 'example.com' }

  it('正常なデータを正しく処理する', () => {
    const values = [
      ['Group Address', 'Forwarding Address 1', 'Forwarding Address 2'],
      ['sales', 'user1@example.com', 'user2@example.com'],
      ['support@example.com', 'user3@example.com', ''],
      ['empty_group', '']
    ]
    const expected = [
      { key: 'sales@example.com', value: JSON.stringify(['user1@example.com', 'user2@example.com']) },
      { key: 'support@example.com', value: JSON.stringify(['user3@example.com']) }
    ]
    expect(processForwardingData(values, mockConfig)).toEqual(expected)
  })

  it('不正なメール形式の場合にエラーをスローする', () => {
    const values = [
      ['Group Address', 'Forwarding Address 1'],
      ['valid_group', 'user1@example.com', 'invalid-email']
    ]
    expect(() => {
      processForwardingData(values, mockConfig)
    }).toThrow('Invalid email address format: "invalid-email" in row 2, column 3')
  })

  it('データが空の場合に空の配列を返す', () => {
    const values = [['Group Address', 'Forwarding Address 1']]
    expect(processForwardingData(values, mockConfig)).toEqual([])
  })

  it('転送先アドレスがない行を正しく処理する', () => {
    const values = [
      ['Group Address', 'Forwarding Address 1'],
      ['no_forward', '', ''],
      ['has_forward', 'user1@example.com']
    ]
    const expected = [{ key: 'has_forward@example.com', value: JSON.stringify(['user1@example.com']) }]
    expect(processForwardingData(values, mockConfig)).toEqual(expected)
  })
})

describe('determineKeysToDelete', () => {
  it('KVに存在するがシートに存在しないキーを返す', () => {
    const sheetKeys = ['a@example.com', 'b@example.com']
    const kvKeys = ['a@example.com', 'c@example.com', 'd@example.com']
    const expected = ['c@example.com', 'd@example.com']
    expect(determineKeysToDelete(sheetKeys, kvKeys)).toEqual(expected)
  })

  it('削除するキーがない場合に空の配列を返す', () => {
    const sheetKeys = ['a@example.com', 'b@example.com']
    const kvKeys = ['a@example.com']
    expect(determineKeysToDelete(sheetKeys, kvKeys)).toEqual([])
  })
})

describe('resolveAndFlattenDestinations', () => {
  const domainName = 'example.com'

  it('自ドメインアドレスを再帰的に解決し、外部アドレスのみを返す', () => {
    const records = [
      { key: 'group-a@example.com', value: '["user1@external.com", "group-b@example.com"]' },
      { key: 'group-b@example.com', value: '["user2@external.com", "group-c@example.com"]' },
      { key: 'group-c@example.com', value: '["user3@external.com"]' }
    ]
    const result = resolveAndFlattenDestinations(records, domainName)
    const expected = [
      {
        key: 'group-a@example.com',
        value: JSON.stringify(['user1@external.com', 'user2@external.com', 'user3@external.com'].sort())
      },
      { key: 'group-b@example.com', value: JSON.stringify(['user2@external.com', 'user3@external.com'].sort()) },
      { key: 'group-c@example.com', value: JSON.stringify(['user3@external.com'].sort()) }
    ]
    // Convert to maps to compare content regardless of record order
    const resultMap = new Map(result.map((r) => [r.key, r.value]))
    const expectedMap = new Map(expected.map((r) => [r.key, r.value]))
    expect(resultMap).toEqual(expectedMap)
  })

  it('重複するアドレスを削除し、ユニークなリストを返す', () => {
    const records = [
      { key: 'group-a@example.com', value: '["user1@external.com", "group-b@example.com"]' },
      { key: 'group-b@example.com', value: '["user1@external.com", "user2@external.com"]' }
    ]
    const result = resolveAndFlattenDestinations(records, domainName)
    const expected = [
      { key: 'group-a@example.com', value: JSON.stringify(['user1@external.com', 'user2@external.com'].sort()) },
      { key: 'group-b@example.com', value: JSON.stringify(['user1@external.com', 'user2@external.com'].sort()) }
    ]
    const resultMap = new Map(result.map((r) => [r.key, r.value]))
    const expectedMap = new Map(expected.map((r) => [r.key, r.value]))
    expect(resultMap).toEqual(expectedMap)
  })

  it('単純な循環参照を検知し、エラーをスローする', () => {
    const records = [
      { key: 'group-a@example.com', value: '["group-b@example.com"]' },
      { key: 'group-b@example.com', value: '["group-a@example.com"]' }
    ]
    const expectedError = '循環参照が検出されました: group-a@example.com -> group-b@example.com -> group-a@example.com'
    expect(() => resolveAndFlattenDestinations(records, domainName)).toThrow(expectedError)
  })

  it('定義されていないグループを参照した場合にエラーをスローする', () => {
    const records = [{ key: 'group-a@example.com', value: '["undefined-group@example.com"]' }]
    const expectedError = '定義されていないグループを参照しています: undefined-group@example.com'
    expect(() => resolveAndFlattenDestinations(records, domainName)).toThrow(expectedError)
  })

  it('Cloudflare上のルールのみを参照して解決できる', () => {
    const records = [{ key: 'group-a@example.com', value: '["cf-group@example.com"]' }]
    const cloudflareRules = new Map([['cf-group@example.com', ['user-cf@external.com']]])
    const result = resolveAndFlattenDestinations(records, domainName, cloudflareRules)
    const expected = [{ key: 'group-a@example.com', value: JSON.stringify(['user-cf@external.com']) }]
    expect(result).toEqual(expected)
  })

  it('シートとCloudflareをまたがる循環参照を検知する', () => {
    const records = [{ key: 'group-a@example.com', value: '["cf-group@example.com"]' }]
    const cloudflareRules = new Map([['cf-group@example.com', ['group-a@example.com']]])
    const expectedError = '循環参照が検出されました: group-a@example.com -> cf-group@example.com -> group-a@example.com'
    expect(() => resolveAndFlattenDestinations(records, domainName, cloudflareRules)).toThrow(expectedError)
  })
})

describe('reconcileRules', () => {
  it('シートにのみ存在するルールはKVへの登録対象として返す', () => {
    const sheetRecords = [{ key: 'a@example.com', value: '["user@a.com"]' }]
    const cloudflareRules = new Map()
    const result = reconcileRules(sheetRecords, cloudflareRules)
    expect(result.recordsForKv).toEqual(sheetRecords)
    expect(result.conflicts).toEqual([])
  })

  it('シートとCloudflareで内容が一致するルールはKV登録対象外とする', () => {
    const sheetRecords = [{ key: 'a@example.com', value: '["user@a.com"]' }]
    const cloudflareRules = new Map([['a@example.com', ['user@a.com']]])
    const result = reconcileRules(sheetRecords, cloudflareRules)
    expect(result.recordsForKv).toEqual([])
    expect(result.conflicts).toEqual([])
  })

  it('シートとCloudflareで内容が不一致のルールは競合として返す', () => {
    const sheetRecords = [{ key: 'a@example.com', value: '["user-sheet@a.com"]' }]
    const cloudflareRules = new Map([['a@example.com', ['user-cf@a.com']]])
    const result = reconcileRules(sheetRecords, cloudflareRules)
    expect(result.recordsForKv).toEqual([])
    expect(result.conflicts).toEqual([
      {
        key: 'a@example.com',
        sheetValue: '["user-sheet@a.com"]',
        cfValue: '["user-cf@a.com"]'
      }
    ])
  })

  it('混合したケースを正しく処理する', () => {
    const sheetRecords = [
      { key: 'kv-only@example.com', value: '["user1@a.com"]' }, // KVへ
      { key: 'match@example.com', value: '["user2@a.com"]' }, // 一致
      { key: 'conflict@example.com', value: '["user-sheet@a.com"]' } // 競合
    ]
    const cloudflareRules = new Map([
      ['match@example.com', ['user2@a.com']],
      ['conflict@example.com', ['user-cf@a.com']]
    ])
    const result = reconcileRules(sheetRecords, cloudflareRules)
    expect(result.recordsForKv).toEqual([{ key: 'kv-only@example.com', value: '["user1@a.com"]' }])
    expect(result.conflicts).toEqual([
      {
        key: 'conflict@example.com',
        sheetValue: '["user-sheet@a.com"]',
        cfValue: '["user-cf@a.com"]'
      }
    ])
  })
})
