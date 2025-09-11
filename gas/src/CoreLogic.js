/**
 * @fileoverview This file contains the core business logic of the application,
 * designed to be independent of the Google Apps Script environment.
 * This allows for local testing and better separation of concerns.
 */

/**
 * Processes forwarding data from a 2D array into a structured format.
 * @param {any[][]} values The 2D array of data from the spreadsheet.
 * @param {{domainName: string}} config Configuration object with domainName.
 * @returns {{key: string, value: string}[]} An array of KV pairs.
 */
function processForwardingData(values, config) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  for (let rowIdx = 1; rowIdx < values.length; rowIdx++) {
    const row = values[rowIdx]
    for (let colIdx = 1; colIdx < row.length; colIdx++) {
      const email = row[colIdx]
      if (email && !emailRegex.test(email)) {
        // In a pure function, we throw an error instead of showing a UI alert.
        // The caller (adapter layer) is responsible for catching it and handling the UI.
        throw new Error(`Invalid email address format: "${email}" in row ${rowIdx + 1}, column ${colIdx + 1}`)
      }
    }
  }

  return values
    .slice(1) // Skip header row
    .map((row) => {
      let key = row[0]
      if (key && !key.includes('@')) {
        key = `${key}@${config.domainName}`
      }
      const valueArray = row.slice(1).filter((email) => email && emailRegex.test(email))
      if (key && valueArray.length > 0) {
        return {
          key: key,
          value: JSON.stringify(valueArray)
        }
      }
      return null
    })
    .filter(Boolean)
}

/**
 * Determines which KV keys to delete based on the current sheet data.
 * @param {string[]} sheetKeys An array of keys from the spreadsheet.
 * @param {string[]} kvKeys An array of keys currently in Cloudflare KV.
 * @returns {string[]} An array of keys that should be deleted from KV.
 */
function determineKeysToDelete(sheetKeys, kvKeys) {
  const sheetKeysSet = new Set(sheetKeys)
  return kvKeys.filter((k) => !sheetKeysSet.has(k))
}

/**
 * Resolves and flattens destination addresses recursively.
 * It replaces internal domain addresses with their members until only external addresses remain.
 * Also detects circular references.
 * @param {{key: string, value: string}[]} records The records processed by processForwardingData.
 * @param {string} domainName The user's domain name.
 * @returns {{key: string, value: string}[]} The flattened records.
 */
function resolveAndFlattenDestinations(records, domainName, cloudflareRules = new Map()) {
  // Combine sheet records and cloudflare rules into a single source of truth for resolution.
  // Sheet records take precedence if a key exists in both.
  const groupMap = new Map(records.map((r) => [r.key, JSON.parse(r.value)]))
  for (const [key, value] of cloudflareRules.entries()) {
    if (!groupMap.has(key)) {
      groupMap.set(key, value)
    }
  }

  const memo = new Map() // Memoization for already resolved groups

  const resolve = (groupAddress, path) => {
    // 1. 循環参照の検出
    if (path.includes(groupAddress)) {
      throw new Error(`循環参照が検出されました: ${[...path, groupAddress].join(' -> ')}`)
    }

    // 2. メモ化された結果の利用
    if (memo.has(groupAddress)) {
      return memo.get(groupAddress)
    }

    // 3. 未定義グループの検出 (now checks combined map)
    if (!groupMap.has(groupAddress)) {
      throw new Error(`定義されていないグループを参照しています: ${groupAddress}`)
    }

    const newPath = [...path, groupAddress]
    const finalDestinations = new Set()
    const destinations = groupMap.get(groupAddress)

    for (const dest of destinations) {
      // 4. 自ドメインのアドレスか判定
      if (dest.endsWith(`@${domainName}`)) {
        // 再帰的に解決
        const resolvedSubDestinations = resolve(dest, newPath)
        resolvedSubDestinations.forEach((subDest) => finalDestinations.add(subDest))
      } else {
        // 外部アドレスはそのまま追加
        finalDestinations.add(dest)
      }
    }

    const result = Array.from(finalDestinations)
    memo.set(groupAddress, result) // 結果をメモ化
    return result
  }

  // We only need to resolve the groups that are actually in the original sheet records.
  const finalRecords = records.map((record) => {
    const flattenedDestinations = resolve(record.key, [])
    return {
      key: record.key,
      value: JSON.stringify(flattenedDestinations.sort())
    }
  })

  return finalRecords
}

/**
 * Reconciles rules from the sheet with rules from Cloudflare.
 * - Identifies conflicts.
 * - Determines which records should actually be written to KV.
 * @param {{key: string, value: string}[]} sheetRecords The records from the sheet.
 * @param {Map<string, string[]>} cloudflareRules The rules from Cloudflare.
 * @returns {{recordsForKv: {key: string, value: string}[], conflicts: {key: string, sheetValue: string, cfValue: string}[]}}
 */
function reconcileRules(sheetRecords, cloudflareRules) {
  const recordsForKv = []
  const conflictingRules = []

  for (const record of sheetRecords) {
    const sheetKey = record.key
    const sheetValue = JSON.parse(record.value).sort()

    if (cloudflareRules.has(sheetKey)) {
      const cfValue = cloudflareRules.get(sheetKey) // Already sorted
      // Conflict
      if (JSON.stringify(sheetValue) !== JSON.stringify(cfValue)) {
        conflictingRules.push({
          key: sheetKey,
          sheetValue: JSON.stringify(sheetValue),
          cfValue: JSON.stringify(cfValue)
        })
      }
      // Match: Do nothing, this record will not be sent to KV.
    } else {
      // Sheet-only rule: This should be sent to KV.
      recordsForKv.push(record)
    }
  }
  return { recordsForKv, conflicts: conflictingRules }
}

/**
 * For local testing with Node.js (vitest).
 * This block is ignored in the Google Apps Script environment.
 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    processForwardingData,
    determineKeysToDelete,
    resolveAndFlattenDestinations,
    reconcileRules
  }
}
