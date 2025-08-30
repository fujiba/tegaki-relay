// --- Configuration ---
const CONFIG_SHEET_NAME = 'settings'
const DATA_SHEET_NAME = 'forwarding_list'
// --- End Configuration ---

/**
 * Adds a custom menu to the spreadsheet UI.
 */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Cloudflare Sync').addItem('Sync Forwarding Lists to KV', 'syncSheetToKV').addToUi()
}

/**
 * Fetches data from the spreadsheet and syncs it to Cloudflare KV.
 */
function syncSheetToKV() {
  try {
    const config = getCloudflareConfig_()
    validateConfig_(config)

    const records = getForwardingData_()
    if (records.length === 0) {
      SpreadsheetApp.getActiveSpreadsheet().toast('No data to sync.', 'Info', 5)
      Logger.log('No valid data found in the forwarding list sheet.')
      return
    }

    const response = updateCloudflareKV_(config, records)
    handleApiResponse_(response)
  } catch (e) {
    Logger.log(`Error during script execution: ${e.message}`)
    SpreadsheetApp.getActiveSpreadsheet().toast(`Error: ${e.message}`, 'Execution Failed', 10)
  }
}

/**
 * Retrieves Cloudflare credentials from the settings sheet and Script Properties.
 * @private
 */
function getCloudflareConfig_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_SHEET_NAME)
  if (!sheet) throw new Error(`Settings sheet named '${CONFIG_SHEET_NAME}' not found.`)

  // Get Account ID and Namespace ID from the sheet
  const data = sheet.getRange('A1:B2').getValues()
  const config = {}
  data.forEach((row) => {
    if (row[0] === 'CF_ACCOUNT_ID') config.accountId = row[1]
    if (row[0] === 'CF_NAMESPACE_ID') config.namespaceId = row[1]
  })

  // Get the API Token from Script Properties for better security
  const scriptProperties = PropertiesService.getScriptProperties()
  config.apiToken = scriptProperties.getProperty('CF_API_TOKEN')

  return config
}

/**
 * Validates the retrieved configuration.
 * @private
 */
function validateConfig_(config) {
  if (!config.accountId || !config.namespaceId || !config.apiToken) {
    throw new Error(
      'Required info (Account ID, Namespace ID, API Token) is missing. Make sure to set the API Token in the Script Properties.'
    )
  }
}

/**
 * Retrieves and formats the forwarding list data.
 * @private
 */
function getForwardingData_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DATA_SHEET_NAME)
  if (!sheet) throw new Error(`Data sheet named '${DATA_SHEET_NAME}' not found.`)

  const values = sheet.getDataRange().getValues()
  if (values.length <= 1) return []

  return values
    .slice(1) // Skip header row
    .map((row) => {
      const key = row[0] // Group address, e.g., info@fujiba.net
      const valueArray = row.slice(1).filter((email) => email && email.includes('@')) // All other non-empty, valid-looking emails

      if (key && valueArray.length > 0) {
        return {
          key: key,
          value: JSON.stringify(valueArray)
        }
      }
      return null
    })
    .filter(Boolean) // Filter out any null entries
}

/**
 * Sends the data to the Cloudflare KV bulk write API.
 * @private
 */
function updateCloudflareKV_(config, payload) {
  const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/storage/kv/namespaces/${config.namespaceId}/bulk`
  const options = {
    method: 'put',
    contentType: 'application/json',
    headers: { Authorization: `Bearer ${config.apiToken}` },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  }
  return UrlFetchApp.fetch(apiUrl, options)
}

/**
 * Handles the response from the Cloudflare API.
 * @private
 */
function handleApiResponse_(response) {
  const responseCode = response.getResponseCode()
  const responseBody = response.getContentText()

  if (responseCode === 200) {
    Logger.log('Successfully synced to Cloudflare KV.')
    SpreadsheetApp.getActiveSpreadsheet().toast('Sync to Cloudflare KV was successful!', 'Success', 5)
  } else {
    Logger.log(`Error: Status Code ${responseCode}, Response: ${responseBody}`)
    throw new Error(`API request failed. Check logs for details.`)
  }
}
