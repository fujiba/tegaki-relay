// --- Configuration ---
const CONFIG_SHEET_NAME = 'settings'
const DATA_SHEET_NAME = 'forwarding_list'
// --- End Configuration ---

/**
 * Adds a custom menu to the spreadsheet UI.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi()
  const ss = SpreadsheetApp.getActiveSpreadsheet()
  const settingsSheet = ss.getSheetByName(CONFIG_SHEET_NAME)
  const dataSheet = ss.getSheetByName(DATA_SHEET_NAME)

  const menu = ui.createMenu('Tegaki Relay')
  if (!(settingsSheet && dataSheet)) {
    menu.addItem('シート初期化', 'initializeSheet')
    menu.addSeparator()
  }
  menu.addItem('Cloudflareへ同期', 'syncSheetToKV')
  menu.addToUi()
}

/**
 * Creates the necessary sheets and headers for the tool to function.
 */
function initializeSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet()
  const ui = SpreadsheetApp.getUi()

  const settingsSheet = ss.getSheetByName(CONFIG_SHEET_NAME)
  const dataSheet = ss.getSheetByName(DATA_SHEET_NAME)

  if (settingsSheet && dataSheet) {
    ui.alert(
      'Initialization Complete',
      'The required sheets ("settings", "forwarding_list") already exist.',
      ui.ButtonSet.OK
    )
    return
  }

  try {
    ss.toast('Initializing sheets...', 'Setup', -1)

    // Rename the default first sheet to 'settings'
    const defaultSheet = ss.getSheets()[0]
    if (!settingsSheet && (defaultSheet.getName() === 'シート1' || defaultSheet.getName() === 'Sheet1')) {
      defaultSheet.setName(CONFIG_SHEET_NAME)
    } else if (!settingsSheet) {
      ss.insertSheet(CONFIG_SHEET_NAME, 0)
    }

    // Create 'forwarding_list' sheet if it doesn't exist
    if (!dataSheet) {
      ss.insertSheet(DATA_SHEET_NAME, 1)
    }

    // Get sheets again to make sure we have the correct objects
    const finalSettingsSheet = ss.getSheetByName(CONFIG_SHEET_NAME)
    const finalDataSheet = ss.getSheetByName(DATA_SHEET_NAME)

    // Set headers and formatting
    finalSettingsSheet.getRange('A1:A2').setValues([['CF_ACCOUNT_ID'], ['CF_NAMESPACE_ID']])
    finalSettingsSheet.getRange('A1:B1').setFontWeight('bold')
    finalDataSheet
      .getRange('A1:C1')
      .setValues([
        [
          'Group Address',
          'Forwarding Address 1',
          'Forwarding Address 2',
          'Forwarding Address 3',
          'Forwarding Address 4',
          'Forwarding Address 5',
          'Forwarding Address 6',
          'Forwarding Address 7',
          'Forwarding Address 8',
          'Forwarding Address 9',
          'Forwarding Address 10'
        ]
      ])
    finalDataSheet.getRange('A1:K1').setFontWeight('bold')

    // Freeze header rows
    finalSettingsSheet.setFrozenRows(1)
    finalDataSheet.setFrozenRows(1)

    ss.toast('Initialization successful!', 'Setup Complete', 5)
    ui.alert(
      'Success',
      'The sheets have been initialized. Please fill in the required values in the "settings" sheet.',
      ui.ButtonSet.OK
    )
  } catch (e) {
    ui.alert('Error', `An error occurred during initialization: ${e.message}`, ui.ButtonSet.OK)
  }
}

/**
 * Fetches all keys from Cloudflare KV.
 * @private
 */
function listCloudflareKVKeys_(config) {
  const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/storage/kv/namespaces/${config.namespaceId}/keys?limit=1000`
  const options = {
    method: 'get',
    headers: { Authorization: `Bearer ${config.apiToken}` },
    muteHttpExceptions: true
  }
  const response = UrlFetchApp.fetch(apiUrl, options)
  if (response.getResponseCode() !== 200) {
    throw new Error(`Failed to fetch KV keys: ${response.getContentText()}`)
  }
  const data = JSON.parse(response.getContentText())
  return data.result.map((item) => item.name)
}

/**
 * Deletes a key from Cloudflare KV.
 * @private
 */
function deleteCloudflareKVKey_(config, key) {
  const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/storage/kv/namespaces/${config.namespaceId}/values/${encodeURIComponent(key)}`
  const options = {
    method: 'delete',
    headers: { Authorization: `Bearer ${config.apiToken}` },
    muteHttpExceptions: true
  }
  const response = UrlFetchApp.fetch(apiUrl, options)
  if (response.getResponseCode() !== 200 && response.getResponseCode() !== 404) {
    throw new Error(`Failed to delete KV key "${key}": ${response.getContentText()}`)
  }
}

/**
 * Fetches data from the spreadsheet and syncs it to Cloudflare KV.
 * Also deletes keys from KV that are not present in the sheet.
 */
function syncSheetToKV() {
  try {
    const config = getCloudflareConfig_()
    validateConfig_(config)
    const ui = SpreadsheetApp.getUi()

    SpreadsheetApp.getActiveSpreadsheet().toast('転送リストをシートから読み込み中...', '同期ステップ 1/4', -1)
    const records = getForwardingData_()
    if (records.length === 0) {
      SpreadsheetApp.getActiveSpreadsheet().toast('同期するデータがありません。', '情報', 5)
      return
    }

    SpreadsheetApp.getActiveSpreadsheet().toast('Cloudflareからメールアドレスの状態を取得中...', '同期ステップ 2/4', -1)
    if (!checkAndHandleUnverifiedEmails_(config, records, ui)) {
      return // 未認証アドレスがあればここで終了
    }

    SpreadsheetApp.getActiveSpreadsheet().toast(
      'すべてのアドレスが認証済みです。Cloudflareへ同期中...',
      '同期ステップ 3/4',
      -1
    )
    syncRecordsToCloudflare_(config, records)
  } catch (e) {
    Logger.log(`エラー: ${e.message}`)
    SpreadsheetApp.getActiveSpreadsheet().toast(`エラーが発生しました: ${e.message}`, '実行失敗', 10)
    SpreadsheetApp.getUi().alert(
      'エラー',
      `処理中にエラーが発生しました。\n\n${e.message}\n\n詳細はログをご確認ください。`,
      SpreadsheetApp.getUi().ButtonSet.OK
    )
  }
}

// 未認証アドレスの確認・登録・ユーザー通知
function checkAndHandleUnverifiedEmails_(config, records, ui) {
  const allCfAddresses = getDestinationAddresses_(config)
  const verifiedEmailsSet = new Set(allCfAddresses.verified)
  const pendingEmailsSet = new Set(allCfAddresses.pending)

  const allDestinationEmails = records.flatMap((record) => JSON.parse(record.value))
  const uniqueDestinationEmails = [...new Set(allDestinationEmails)]

  const unverifiedEmails = uniqueDestinationEmails.filter((email) => !verifiedEmailsSet.has(email))

  if (unverifiedEmails.length === 0) {
    return true
  }

  const emailsPendingVerification = unverifiedEmails.filter((email) => pendingEmailsSet.has(email))
  const emailsToCreate = unverifiedEmails.filter((email) => !pendingEmailsSet.has(email))

  let creationResults = { success: [], failed: [] }

  if (emailsToCreate.length > 0) {
    const confirmMsg = `以下のメールアドレスはCloudflareに未登録です。\n\n- ${emailsToCreate.join('\n- ')}\n\n自動でCloudflareに登録しますか？（typo等がないかご確認ください）`
    const uiResult = ui.alert('未登録アドレスの確認', confirmMsg, ui.ButtonSet.YES_NO)
    if (uiResult === ui.Button.NO) {
      SpreadsheetApp.getActiveSpreadsheet().toast('同期を中断しました。', '中断', 5)
      return false
    }
    SpreadsheetApp.getActiveSpreadsheet().toast('新しいメールアドレスを作成中...', '同期ステップ 3/4', -1)
    creationResults = createDestinationAddresses_(config, emailsToCreate)
  }

  let message = ''
  if (emailsPendingVerification.length > 0) {
    message += `以下のアドレスは認証待ちです。受信トレイに届いている認証メールをご確認ください:\n\n- ${emailsPendingVerification.join('\n- ')}\n`
  }
  if (creationResults.success.length > 0) {
    message += `\n以下の新しい転送先アドレスを作成し、認証メールを送信しました:\n\n- ${creationResults.success.join('\n- ')}\n\n各アドレスの受信トレイで認証リンクをクリックしてください。\n`
  }
  if (creationResults.failed.length > 0) {
    message += `\n以下のアドレスは自動作成できませんでした。ログを確認するか、Cloudflareで手動追加してください:\n\n- ${creationResults.failed.join('\n- ')}\n`
  }
  message += '\nすべてのアドレスが認証されてから再度同期を実行してください。'

  ui.alert('認証が必要なメールアドレスがあります', message, ui.ButtonSet.OK)
  return false
}

// KVの削除・同期
function syncRecordsToCloudflare_(config, records) {
  const sheetKeys = records.map((r) => r.key)
  const kvKeys = listCloudflareKVKeys_(config)
  const keysToDelete = kvKeys.filter((k) => !sheetKeys.includes(k))

  keysToDelete.forEach((key) => {
    deleteCloudflareKVKey_(config, key)
    Logger.log(`Deleted KV key: ${key}`)
  })

  if (records.length === 0) {
    SpreadsheetApp.getActiveSpreadsheet().toast('同期するデータがありません。', '情報', 5)
    Logger.log('転送リストシートに有効なデータがありません。')
    return
  }

  const response = updateCloudflareKV_(config, records)
  handleApiResponse_(response)
}

/**
 * Attempts to create new destination addresses in Cloudflare Email Routing.
 * @private
 */
function createDestinationAddresses_(config, emailsToCreate) {
  const success = []
  const failed = []

  emailsToCreate.forEach((email) => {
    const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/email/routing/addresses`
    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: `Bearer ${config.apiToken}` },
      payload: JSON.stringify({ email: email }),
      muteHttpExceptions: true
    }

    const response = UrlFetchApp.fetch(apiUrl, options)
    const responseCode = response.getResponseCode()
    const responseBody = response.getContentText()

    if (responseCode === 200) {
      const json = JSON.parse(responseBody)
      if (json.success) {
        Logger.log(`Successfully created destination address: ${email}`)
        success.push(email)
      } else {
        Logger.log(`Failed to create destination address ${email}. API Error: ${responseBody}`)
        failed.push(email)
      }
    } else {
      Logger.log(
        `Failed to create destination address ${email}. HTTP Status: ${responseCode}, Response: ${responseBody}`
      )
      failed.push(email)
    }
  })

  return { success, failed }
}

/**
 * Retrieves all destination email addresses from Cloudflare Email Routing,
 * categorized by their verification status.
 * @private
 */
function getDestinationAddresses_(config) {
  const addresses = {
    verified: [],
    pending: []
  }
  let page = 1
  let hasMorePages = true

  while (hasMorePages) {
    const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/email/routing/addresses?page=${page}&per_page=100`
    const options = {
      method: 'get',
      contentType: 'application/json',
      headers: { Authorization: `Bearer ${config.apiToken}` },
      muteHttpExceptions: true
    }

    const response = UrlFetchApp.fetch(apiUrl, options)
    const responseCode = response.getResponseCode()
    const responseBody = response.getContentText()

    if (responseCode !== 200) {
      Logger.log(`Error fetching destination addresses: Status Code ${responseCode}, Response: ${responseBody}`)
      throw new Error('Could not fetch destination email addresses from Cloudflare. Check logs.')
    }

    const json = JSON.parse(responseBody)
    if (!json.success) {
      Logger.log(`API error while fetching destination addresses: ${JSON.stringify(json.errors)}`)
      throw new Error('Cloudflare API returned an error while fetching destination addresses.')
    }

    json.result.forEach((addr) => {
      if (addr.verified) {
        addresses.verified.push(addr.email)
      } else {
        addresses.pending.push(addr.email)
      }
    })

    const totalPages =
      json.result_info && json.result_info.total_count
        ? Math.ceil(json.result_info.total_count / json.result_info.per_page)
        : 1
    if (page >= totalPages || totalPages === 0) {
      hasMorePages = false
    } else {
      page++
    }
  }

  return addresses
}

/**
 * Retrieves Cloudflare credentials from the settings sheet and Script Properties.
 * @private
 */
function getCloudflareConfig_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_SHEET_NAME)
  if (!sheet)
    throw new Error(
      `Settings sheet named '${CONFIG_SHEET_NAME}' not found. Please run "Initialize Sheet" from the menu.`
    )

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
  if (!sheet)
    throw new Error(`Data sheet named '${DATA_SHEET_NAME}' not found. Please run "Initialize Sheet" from the menu.`)

  const values = sheet.getDataRange().getValues()
  if (values.length <= 1) return []

  // メールアドレスのバリデーション用正規表現
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  for (let rowIdx = 1; rowIdx < values.length; rowIdx++) {
    // 1行目はヘッダー
    const row = values[rowIdx]
    for (let colIdx = 1; colIdx < row.length; colIdx++) {
      // 1列目はグループアドレス
      const email = row[colIdx]
      if (email && !emailRegex.test(email)) {
        // 該当セルを選択
        sheet.setActiveRange(sheet.getRange(rowIdx + 1, colIdx + 1))
        SpreadsheetApp.getUi().alert(
          `メールアドレスの形式が正しくありません: "${email}"\nセル: ${sheet.getRange(rowIdx + 1, colIdx + 1).getA1Notation()}`
        )
        throw new Error(`Invalid email address: ${email}`)
      }
    }
  }

  return values
    .slice(1) // Skip header row
    .map((row) => {
      const key = row[0] // Group address
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
    Logger.log('Successfully synced to Cloudflare.')
    SpreadsheetApp.getActiveSpreadsheet().toast('Cloudflareへの同期が成功しました。', '成功', 5)
  } else {
    Logger.log(`Error: Status Code ${responseCode}, Response: ${responseBody}`)
    SpreadsheetApp.getActiveSpreadsheet().toast(
      `Cloudflareへの同期に失敗しました（ステータス: ${responseCode}）。詳細はログを確認してください。`,
      'エラー',
      10
    )
    throw new Error(`APIリクエストに失敗しました。詳細はログをご確認ください。`)
  }
}
