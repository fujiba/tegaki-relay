// --- Configuration ---
const CONFIG_SHEET_NAME = 'settings';
const DATA_SHEET_NAME = 'forwarding_list';
// --- End Configuration ---

/**
 * Adds a custom menu to the spreadsheet UI.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Tegaki Relay')
    .addItem('Initialize Sheet', 'initializeSheet')
    .addSeparator()
    .addItem('Sync to Cloudflare KV', 'syncSheetToKV')
    .addToUi();
}

/**
 * Creates the necessary sheets and headers for the tool to function.
 */
function initializeSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();

  const settingsSheet = ss.getSheetByName(CONFIG_SHEET_NAME);
  const dataSheet = ss.getSheetByName(DATA_SHEET_NAME);

  if (settingsSheet && dataSheet) {
    ui.alert('Initialization Complete', 'The required sheets ("settings", "forwarding_list") already exist.', ui.ButtonSet.OK);
    return;
  }

  try {
    ss.toast('Initializing sheets...', 'Setup', -1);
    
    // Rename the default first sheet to 'settings'
    const defaultSheet = ss.getSheets()[0];
    if (!settingsSheet && (defaultSheet.getName() === 'シート1' || defaultSheet.getName() === 'Sheet1')) {
        defaultSheet.setName(CONFIG_SHEET_NAME);
    } else if (!settingsSheet) {
        ss.insertSheet(CONFIG_SHEET_NAME, 0);
    }
    
    // Create 'forwarding_list' sheet if it doesn't exist
    if (!dataSheet) {
        ss.insertSheet(DATA_SHEET_NAME, 1);
    }

    // Get sheets again to make sure we have the correct objects
    const finalSettingsSheet = ss.getSheetByName(CONFIG_SHEET_NAME);
    const finalDataSheet = ss.getSheetByName(DATA_SHEET_NAME);

    // Set headers and formatting
    finalSettingsSheet.getRange('A1:A2').setValues([['CF_ACCOUNT_ID'], ['CF_NAMESPACE_ID']]);
    finalSettingsSheet.getRange('A1:B1').setFontWeight('bold');
    finalDataSheet.getRange('A1:C1').setValues([[
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
        'Forwarding Address 10',
      ]]);
    finalDataSheet.getRange('A1:K1').setFontWeight('bold');

    // Freeze header rows
    finalSettingsSheet.setFrozenRows(1);
    finalDataSheet.setFrozenRows(1);
    
    ss.toast('Initialization successful!', 'Setup Complete', 5);
    ui.alert('Success', 'The sheets have been initialized. Please fill in the required values in the "settings" sheet.', ui.ButtonSet.OK);

  } catch(e) {
    ui.alert('Error', `An error occurred during initialization: ${e.message}`, ui.ButtonSet.OK);
  }
}


/**
 * Fetches data from the spreadsheet and syncs it to Cloudflare KV.
 */
function syncSheetToKV() {
  try {
    const config = getCloudflareConfig_();
    validateConfig_(config);

    const records = getForwardingData_();
    if (records.length === 0) {
      SpreadsheetApp.getActiveSpreadsheet().toast('No data to sync.', 'Info', 5);
      Logger.log('No valid data found in the forwarding list sheet.');
      return;
    }

    const response = updateCloudflareKV_(config, records);
    handleApiResponse_(response);

  } catch (e) {
    Logger.log(`Error during script execution: ${e.message}`);
    SpreadsheetApp.getActiveSpreadsheet().toast(`Error: ${e.message}`, 'Execution Failed', 10);
  }
}

/**
 * Retrieves Cloudflare credentials from the settings sheet and Script Properties.
 * @private
 */
function getCloudflareConfig_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_SHEET_NAME);
  if (!sheet) throw new Error(`Settings sheet named '${CONFIG_SHEET_NAME}' not found. Please run "Initialize Sheet" from the menu.`);
  
  // Get Account ID and Namespace ID from the sheet
  const data = sheet.getRange('A1:B2').getValues();
  const config = {};
  data.forEach(row => {
    if (row[0] === 'CF_ACCOUNT_ID') config.accountId = row[1];
    if (row[0] === 'CF_NAMESPACE_ID') config.namespaceId = row[1];
  });

  // Get the API Token from Script Properties for better security
  const scriptProperties = PropertiesService.getScriptProperties();
  config.apiToken = scriptProperties.getProperty('CF_API_TOKEN');

  return config;
}

/**
 * Validates the retrieved configuration.
 * @private
 */
function validateConfig_(config) {
  if (!config.accountId || !config.namespaceId || !config.apiToken) {
    throw new Error('Required info (Account ID, Namespace ID, API Token) is missing. Make sure to set the API Token in the Script Properties.');
  }
}

/**
 * Retrieves and formats the forwarding list data.
 * @private
 */
function getForwardingData_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DATA_SHEET_NAME);
  if (!sheet) throw new Error(`Data sheet named '${DATA_SHEET_NAME}' not found. Please run "Initialize Sheet" from the menu.`);
  
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  return values.slice(1) // Skip header row
    .map(row => {
      const key = row[0]; // Group address, e.g., info@fujiba.net
      const valueArray = row.slice(1).filter(email => email && email.includes('@')); // All other non-empty, valid-looking emails
      
      if (key && valueArray.length > 0) {
        return {
          key: key,
          value: JSON.stringify(valueArray),
        };
      }
      return null;
    }).filter(Boolean); // Filter out any null entries
}

/**
 * Sends the data to the Cloudflare KV bulk write API.
 * @private
 */
function updateCloudflareKV_(config, payload) {
  const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/storage/kv/namespaces/${config.namespaceId}/bulk`;
  const options = {
    method: 'put',
    contentType: 'application/json',
    headers: { 'Authorization': `Bearer ${config.apiToken}` },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };
  return UrlFetchApp.fetch(apiUrl, options);
}

/**
 * Handles the response from the Cloudflare API.
 * @private
 */
function handleApiResponse_(response) {
  const responseCode = response.getResponseCode();
  const responseBody = response.getContentText();

  if (responseCode === 200) {
    Logger.log('Successfully synced to Cloudflare KV.');
    SpreadsheetApp.getActiveSpreadsheet().toast('Sync to Cloudflare KV was successful!', 'Success', 5);
  } else {
    Logger.log(`Error: Status Code ${responseCode}, Response: ${responseBody}`);
    throw new Error(`API request failed. Check logs for details.`);
  }
}

