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
  menu.addItem('Dry Runを実行', 'dryRunSync')
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
    finalSettingsSheet.getRange('A1:A3').setValues([['CF_ACCOUNT_ID'], ['CF_NAMESPACE_ID'], ['DOMAIN_NAME']])
    finalSettingsSheet.getRange('A1:A3').setFontWeight('bold')
    finalDataSheet
      .getRange('A1:K1')
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
      .setFontWeight('bold') // setValuesに続けてスタイルを設定

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
 * Fetches data from the spreadsheet and syncs it to Cloudflare KV.
 * Also deletes keys from KV that are not present in the sheet.
 */
function syncSheetToKV() {
  try {
    const ui = SpreadsheetApp.getUi()
    const confirmResponse = ui.alert(
      '本番環境へ同期します',
      'Cloudflare上の設定が上書きされます。よろしいですか？\n\n（事前にDry Runの実行を推奨します）',
      ui.ButtonSet.YES_NO
    )

    if (confirmResponse !== ui.Button.YES) {
      SpreadsheetApp.getActiveSpreadsheet().toast('同期をキャンセルしました。', 'キャンセル', 5)
      return
    }

    const config = getCloudflareConfig_()
    validateConfig_(config)
    const apiClient = new CloudflareApiClient(config, UrlFetchApp.fetch)

    SpreadsheetApp.getActiveSpreadsheet().toast('転送リストをシートから読み込み中...', '同期ステップ 1/5', -1)
    let records = getForwardingData_(config)
    if (records.length === 0) {
      SpreadsheetApp.getActiveSpreadsheet().toast('同期するデータがありません。', '情報', 5)
      return
    }

    SpreadsheetApp.getActiveSpreadsheet().toast('転送グループを解決中...', '同期ステップ 2/5', -1)
    try {
      records = resolveAndFlattenDestinations(records, config.domainName)
    } catch (e) {
      ui.alert('設定エラー', `転送ルールの設定に問題があります。\n\n${e.message}`, ui.ButtonSet.OK)
      return // エラーを再スローせず、ここで処理を終了する
    }

    SpreadsheetApp.getActiveSpreadsheet().toast('Cloudflareからメールアドレスの状態を取得中...', '同期ステップ 3/5', -1)
    if (!checkAndHandleUnverifiedEmails_(apiClient, records, ui)) {
      return // 未認証アドレスがあればここで終了
    }

    SpreadsheetApp.getActiveSpreadsheet().toast('Cloudflare KVへデータを同期中...', '同期ステップ 4/5', -1)
    syncRecordsToCloudflare_(apiClient, records)
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

/**
 * Performs a dry run of the sync process and outputs the results to a sheet.
 */
function dryRunSync() {
  const SPREADSHEET_URL = SpreadsheetApp.getActiveSpreadsheet().getUrl()
  try {
    const config = getCloudflareConfig_()
    validateConfig_(config)
    const apiClient = new CloudflareApiClient(config, UrlFetchApp.fetch)
    const ui = SpreadsheetApp.getUi()

    SpreadsheetApp.getActiveSpreadsheet().toast('Dry Run: 転送リストを読み込み中...', 'Dry Run', -1)
    let records = getForwardingData_(config)
    if (records.length === 0) {
      SpreadsheetApp.getActiveSpreadsheet().toast('同期するデータがありません。', '情報', 5)
      return
    }

    SpreadsheetApp.getActiveSpreadsheet().toast('Dry Run: 転送グループを解決中...', 'Dry Run', -1)
    try {
      records = resolveAndFlattenDestinations(records, config.domainName)
    } catch (e) {
      ui.alert('設定エラー', `転送ルールの設定に問題があります。\n\n${e.message}`, ui.ButtonSet.OK)
      return // エラーを再スローせず、ここで処理を終了する
    }

    SpreadsheetApp.getActiveSpreadsheet().toast('Dry Run: 変更点を計算中...', 'Dry Run', -1)
    // Get info without UI interaction or writing data
    const unverifiedInfo = getUnverifiedEmailInfo_(apiClient, records)
    const syncPlan = getSyncPlan_(apiClient, records)

    // Write report
    writeDryRunReport_(syncPlan, unverifiedInfo)

    const resultSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('dry-run-result')
    SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(resultSheet)
    SpreadsheetApp.getActiveSpreadsheet().toast(
      'Dry Runが完了しました。結果シートを確認してください。',
      'Dry Run 完了',
      10
    )
  } catch (e) {
    Logger.log(`Dry Run エラー: ${e.message}`)
    SpreadsheetApp.getUi().alert(
      'Dry Run エラー',
      `処理中にエラーが発生しました。\n\n${e.message}\n\n詳細はログをご確認ください。`,
      SpreadsheetApp.getUi().ButtonSet.OK
    )
  }
}

// 未認証アドレスの確認・登録・ユーザー通知
function checkAndHandleUnverifiedEmails_(apiClient, records, ui) {
  const allCfAddresses = apiClient.getDestinationAddresses()
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
    SpreadsheetApp.getActiveSpreadsheet().toast('新しいメールアドレスを作成中...', '同期ステップ 4/5', -1)
    creationResults = createDestinationAddresses_(apiClient, emailsToCreate)
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

/**
 * Gathers information about unverified emails without any UI interaction.
 * @private
 */
function getUnverifiedEmailInfo_(apiClient, records) {
  const allCfAddresses = apiClient.getDestinationAddresses()
  const verifiedEmailsSet = new Set(allCfAddresses.verified)
  const pendingEmailsSet = new Set(allCfAddresses.pending)
  const allDestinationEmails = records.flatMap((record) => JSON.parse(record.value))
  const uniqueDestinationEmails = [...new Set(allDestinationEmails)]
  const unverifiedEmails = uniqueDestinationEmails.filter((email) => !verifiedEmailsSet.has(email))
  return {
    emailsToCreate: unverifiedEmails.filter((email) => !pendingEmailsSet.has(email)),
    emailsPendingVerification: unverifiedEmails.filter((email) => pendingEmailsSet.has(email))
  }
}

// KVの削除・同期
function syncRecordsToCloudflare_(apiClient, records) {
  const sheetKeys = records.map((r) => r.key)
  const kvKeys = apiClient.listKvKeys()
  const keysToDelete = determineKeysToDelete(sheetKeys, kvKeys)

  keysToDelete.forEach((key) => {
    apiClient.deleteKvKey(key)
    Logger.log(`Deleted KV key: ${key}`)
  })

  if (records.length === 0) {
    SpreadsheetApp.getActiveSpreadsheet().toast('同期するデータがありません。', '情報', 5)
    Logger.log('転送リストシートに有効なデータがありません。')
    return
  }

  const response = apiClient.updateKvBulk(records)
  handleApiResponse_(response)
}

/**
 * Calculates the changes to be made in KV without actually performing them.
 * @private
 */
function getSyncPlan_(apiClient, records) {
  const sheetKeys = records.map((r) => r.key)
  const kvKeys = apiClient.listKvKeys()
  return {
    keysToDelete: determineKeysToDelete(sheetKeys, kvKeys),
    recordsToUpdate: records
  }
}

/**
 * Attempts to create new destination addresses in Cloudflare Email Routing.
 * @private
 */
function createDestinationAddresses_(apiClient, emailsToCreate) {
  const success = []
  const failed = []

  emailsToCreate.forEach((email) => {
    const result = apiClient.createDestinationAddress(email)
    if (result.success) {
      Logger.log(`Successfully created destination address: ${email}`)
      success.push(email)
    } else {
      Logger.log(`Failed to create destination address ${email}. API Error: ${result.body}`)
      failed.push(email)
    }
  })

  return { success, failed }
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
  const data = sheet.getRange('A1:B3').getValues()
  const config = {}
  data.forEach((row) => {
    if (row[0] === 'CF_ACCOUNT_ID') config.accountId = row[1]
    if (row[0] === 'CF_NAMESPACE_ID') config.namespaceId = row[1]
    if (row[0] === 'DOMAIN_NAME') config.domainName = row[1]
  })

  // Get the API Token from Script Properties for better security
  const scriptProperties = PropertiesService.getScriptProperties()
  config.apiToken = scriptProperties.getProperty('CLOUDFLARE_API_TOKEN')

  return config
}

/**
 * Validates the retrieved configuration.
 * @private
 */
function validateConfig_(config) {
  const missingItems = []
  if (!config.accountId) {
    missingItems.push('CF_ACCOUNT_ID (settingsシート)')
  }
  if (!config.namespaceId) {
    missingItems.push('CF_NAMESPACE_ID (settingsシート)')
  }
  if (!config.domainName) {
    missingItems.push('DOMAIN_NAME (settingsシート)')
  }
  if (!config.apiToken) {
    missingItems.push('CLOUDFLARE_API_TOKEN (スクリプトプロパティ)')
  }

  if (missingItems.length > 0) {
    const errorMessage = `以下の設定が不足しています:\n\n- ${missingItems.join('\n- ')}\n\n設定を再度ご確認ください。`
    throw new Error(errorMessage)
  }
}

/**
 * Retrieves and formats the forwarding list data.
 * @private
 */
function getForwardingData_(config) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DATA_SHEET_NAME)
  if (!sheet)
    throw new Error(`Data sheet named '${DATA_SHEET_NAME}' not found. Please run "Initialize Sheet" from the menu.`)

  const values = sheet.getDataRange().getValues()
  if (values.length <= 1) return []

  try {
    // Call the pure function from CoreLogic.js
    return processForwardingData(values, config)
  } catch (e) {
    // Catch errors from the core logic and handle them in the GAS environment (e.g., show UI alerts)
    const rowMatch = e.message.match(/row (\d+)/)
    const colMatch = e.message.match(/column (\d+)/)
    if (rowMatch && colMatch) {
      const errorRow = parseInt(rowMatch[1], 10)
      const errorCol = parseInt(colMatch[1], 10)
      sheet.setActiveRange(sheet.getRange(errorRow, errorCol))
    }
    SpreadsheetApp.getUi().alert(
      `データ形式エラー`,
      `シートのデータに問題があります。\n\n${e.message}`,
      SpreadsheetApp.getUi().ButtonSet.OK
    )
    throw e // Re-throw to stop the sync process
  }
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

/**
 * Writes the results of a dry run to a dedicated sheet.
 * @private
 */
function writeDryRunReport_(syncPlan, unverifiedInfo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet()
  const sheetName = 'dry-run-result'
  let sheet = ss.getSheetByName(sheetName)
  if (!sheet) {
    sheet = ss.insertSheet(sheetName)
  } else {
    sheet.clear()
  }

  let currentRow = 1

  // --- Records to Update ---
  sheet.getRange(currentRow, 1).setValue('■ KVへ投入されるデータ (更新/作成)').setFontWeight('bold')
  currentRow++
  if (syncPlan.recordsToUpdate.length > 0) {
    sheet
      .getRange(currentRow, 1, 1, 2)
      .setValues([['キー', '値']])
      .setFontWeight('bold')
    const updateData = syncPlan.recordsToUpdate.map((r) => [r.key, r.value])
    sheet.getRange(currentRow + 1, 1, updateData.length, 2).setValues(updateData)
    currentRow += updateData.length + 2
  } else {
    sheet.getRange(currentRow, 1).setValue('なし')
    currentRow += 2
  }

  // --- Records to Delete ---
  sheet.getRange(currentRow, 1).setValue('■ KVから削除されるデータ').setFontWeight('bold')
  currentRow++
  if (syncPlan.keysToDelete.length > 0) {
    const deleteData = syncPlan.keysToDelete.map((k) => [k])
    sheet.getRange(currentRow, 1, deleteData.length, 1).setValues(deleteData)
    currentRow += deleteData.length + 2
  } else {
    sheet.getRange(currentRow, 1).setValue('なし')
    currentRow += 2
  }

  // --- Unverified Emails ---
  sheet.getRange(currentRow, 1).setValue('■ 要認証 / 要作成のアドレス').setFontWeight('bold')
  currentRow++
  const allUnverified = [...unverifiedInfo.emailsToCreate, ...unverifiedInfo.emailsPendingVerification]
  if (allUnverified.length > 0) {
    const unverifiedData = allUnverified.map((e) => [e])
    sheet.getRange(currentRow, 1, unverifiedData.length, 1).setValues(unverifiedData)
  } else {
    sheet.getRange(currentRow, 1).setValue('なし')
  }

  sheet.autoResizeColumns(1, 2)
}
