/**
 * @file Cloudflare Email Worker for forwarding emails based on a KV store.
 *
 * This worker intercepts incoming emails via a catch-all route,
 * looks up the recipient address in a Cloudflare KV namespace,
 * and forwards the email to a list of destination addresses if found.
 * If the recipient is not found or the forwarding list is invalid,
 * the email is rejected.
 */

/**
 * Parses and validates the forwarding list from KV.
 * @param {string | null} forwardingListJson The JSON string from KV.
 * @returns {{addresses?: string[], error?: string}} An object with either the addresses or an error message.
 */
function getForwardingAddresses(forwardingListJson) {
  try {
    const addresses = JSON.parse(forwardingListJson)
    if (Array.isArray(addresses) && addresses.length > 0) {
      return { addresses }
    }
    return { error: 'Address does not exist.' }
  } catch (e) {
    return { error: 'Configuration error: Invalid forwarding list format.' }
  }
}
export default {
  /**
   * Handles incoming emails.
   * This function is triggered for each email received by the Cloudflare Email Routing rule.
   * It looks up the recipient in the FORWARDING_LIST_KV. If a corresponding
   * list of forwarding addresses is found, it forwards the email to each address.
   * Otherwise, it rejects the email.
   *
   * @param {EmailMessage} message - The incoming email message object provided by the Cloudflare runtime.
   * @param {object} env - The environment object containing bindings, like KV namespaces.
   * @param {KVNamespace} env.FORWARDING_LIST_KV - The KV namespace storing the forwarding rules.
   *        The key is the recipient email address (e.g., "info@example.com"),
   *        and the value is a JSON string array of forwarding email addresses
   *        (e.g., '["user1@example.net", "user2@example.net"]').
   * @returns {Promise<void>} A promise that resolves when the email has been processed.
   */
  async email(message, env) {
    // The recipient group address (e.g., info@example.com)
    const recipient = message.to

    // The KV key is the recipient address itself
    const forwardingListJson = await env.FORWARDING_LIST_KV.get(recipient, 'text')

    if (!forwardingListJson) {
      // If the key does not exist in KV, reject the email
      console.log(`Recipient ${recipient} not found in KV. Bouncing.`)
      message.setReject('Address does not exist at this domain.')
      return
    }

    const { addresses, error } = getForwardingAddresses(forwardingListJson)

    if (error) {
      console.error(`Error processing forwarding for ${recipient}: ${error}`)
      message.setReject(error)
      return
    }

    console.log(`Forwarding ${recipient} to: ${addresses.join(', ')}`)
    await Promise.all(addresses.map((address) => message.forward(address))).catch((err) => {
      const errorMessage = `Failed to forward to one or more addresses for ${recipient}: ${err.message}`
      console.error(errorMessage)
      message.setReject(errorMessage)
    })
  }
}
