/**
 * @fileoverview A client for interacting with the Cloudflare API.
 * This class encapsulates all API calls, making the main logic cleaner
 * and allowing for easier testing by mocking the fetcher.
 */

class CloudflareApiClient {
  /**
   * @param {{accountId: string, namespaceId: string, apiToken: string}} config The Cloudflare configuration.
   * @param {function} fetcher The function to use for making HTTP requests (e.g., UrlFetchApp.fetch).
   */
  constructor(config, fetcher) {
    if (!config || !fetcher) {
      throw new Error('CloudflareApiClient requires config and a fetcher function.')
    }
    this.config = config
    this.fetcher = fetcher
    this.baseApiUrl = 'https://api.cloudflare.com/client/v4'
  }

  /**
   * Fetches all keys from Cloudflare KV.
   * @returns {string[]} An array of KV keys.
   */
  listKvKeys() {
    const apiUrl = `${this.baseApiUrl}/accounts/${this.config.accountId}/storage/kv/namespaces/${this.config.namespaceId}/keys?limit=1000`
    const options = {
      method: 'get',
      headers: { Authorization: `Bearer ${this.config.apiToken}` },
      muteHttpExceptions: true
    }
    const response = this.fetcher(apiUrl, options)
    if (response.getResponseCode() !== 200) {
      throw new Error(`Failed to fetch KV keys: ${response.getContentText()}`)
    }
    const data = JSON.parse(response.getContentText())
    return data.result.map((item) => item.name)
  }

  /**
   * Deletes a key from Cloudflare KV.
   * @param {string} key The key to delete.
   */
  deleteKvKey(key) {
    const apiUrl = `${this.baseApiUrl}/accounts/${this.config.accountId}/storage/kv/namespaces/${this.config.namespaceId}/values/${encodeURIComponent(key)}`
    const options = {
      method: 'delete',
      headers: { Authorization: `Bearer ${this.config.apiToken}` },
      muteHttpExceptions: true
    }
    const response = this.fetcher(apiUrl, options)
    if (response.getResponseCode() !== 200 && response.getResponseCode() !== 404) {
      throw new Error(`Failed to delete KV key "${key}": ${response.getContentText()}`)
    }
  }

  /**
   * Sends the data to the Cloudflare KV bulk write API.
   * @param {object[]} payload The data to write.
   * @returns {GoogleAppsScript.URL_Fetch.HTTPResponse} The API response.
   */
  updateKvBulk(payload) {
    const apiUrl = `${this.baseApiUrl}/accounts/${this.config.accountId}/storage/kv/namespaces/${this.config.namespaceId}/bulk`
    const options = {
      method: 'put',
      contentType: 'application/json',
      headers: { Authorization: `Bearer ${this.config.apiToken}` },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    }
    return this.fetcher(apiUrl, options)
  }

  /**
   * Attempts to create a new destination address in Cloudflare Email Routing.
   * @param {string} email The email address to create.
   * @returns {{success: boolean, body: string}} The result of the creation attempt.
   */
  createDestinationAddress(email) {
    const apiUrl = `${this.baseApiUrl}/accounts/${this.config.accountId}/email/routing/addresses`
    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: `Bearer ${this.config.apiToken}` },
      payload: JSON.stringify({ email: email }),
      muteHttpExceptions: true
    }

    const response = this.fetcher(apiUrl, options)
    const responseCode = response.getResponseCode()
    const responseBody = response.getContentText()

    if (responseCode === 200) {
      const json = JSON.parse(responseBody)
      return { success: json.success, body: responseBody }
    }
    return { success: false, body: responseBody }
  }

  /**
   * Retrieves all destination email addresses from Cloudflare Email Routing.
   * @returns {{verified: string[], pending: string[]}} An object with verified and pending emails.
   */
  getDestinationAddresses() {
    const addresses = { verified: [], pending: [] }
    let page = 1
    let hasMorePages = true

    while (hasMorePages) {
      const apiUrl = `${this.baseApiUrl}/accounts/${this.config.accountId}/email/routing/addresses?page=${page}&per_page=100`
      const options = {
        method: 'get',
        contentType: 'application/json',
        headers: { Authorization: `Bearer ${this.config.apiToken}` },
        muteHttpExceptions: true
      }

      const response = this.fetcher(apiUrl, options)
      if (response.getResponseCode() !== 200) {
        throw new Error(
          `Could not fetch destination email addresses from Cloudflare. Check logs. Body: ${response.getContentText()}`
        )
      }

      const json = JSON.parse(response.getContentText())
      if (!json.success) {
        throw new Error('Cloudflare API returned an error while fetching destination addresses.')
      }

      json.result.forEach((addr) => {
        if (addr.verified) addresses.verified.push(addr.email)
        else addresses.pending.push(addr.email)
      })

      const totalPages = json.result_info ? Math.ceil(json.result_info.total_count / json.result_info.per_page) : 1
      hasMorePages = page < totalPages
      page++
    }
    return addresses
  }

  /**
   * Retrieves all email routing rules.
   * @returns {Map<string, string[]>} A map where the key is the routing address and the value is an array of destination emails.
   */
  listRoutingRules() {
    const rulesMap = new Map()
    let page = 1
    let hasMorePages = true

    while (hasMorePages) {
      const apiUrl = `${this.baseApiUrl}/zones/${this.config.zoneId}/email/routing/rules?page=${page}&per_page=100`
      const options = {
        method: 'get',
        headers: { Authorization: `Bearer ${this.config.apiToken}` },
        muteHttpExceptions: true
      }

      const response = this.fetcher(apiUrl, options)
      if (response.getResponseCode() !== 200) {
        throw new Error(`Could not fetch email routing rules from Cloudflare. Body: ${response.getContentText()}`)
      }

      const json = JSON.parse(response.getContentText())
      if (!json.success) {
        throw new Error('Cloudflare API returned an error while fetching email routing rules.')
      }

      json.result.forEach((rule) => {
        // We only care about literal "to" matchers
        const literalMatcher = rule.matchers.find((m) => m.type === 'literal' && m.field === 'to')

        if (literalMatcher) {
          // and "forward" actions
          const destinations = rule.actions.filter((a) => a.type === 'forward').flatMap((a) => a.value)
          if (destinations.length > 0) {
            rulesMap.set(literalMatcher.value, destinations.sort())
          }
        }
      })

      const totalPages = json.result_info ? Math.ceil(json.result_info.total_count / json.result_info.per_page) : 1
      hasMorePages = page < totalPages
      page++
    }
    return rulesMap
  }
}

/**
 * For local testing with Node.js (vitest).
 * This block is ignored in the Google Apps Script environment.
 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CloudflareApiClient }
}
