// Empties the Chrome Web Store listing fields for every language in the dropdown.
// Paste into the DevTools console on the item's "Store listing" page, then click the red button.
// Only the draft form changes: nothing is stored until "Save draft", and a page reload discards it.
// The name and any read-only summary come from the uploaded package and stay as they are.

const WAIT = 1200
const SHORT_MAX = 132
const FULL_MAX = 16000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const x = (p) => document.evaluate(p, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
const isVisible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
const setters = {
  TEXTAREA: Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set,
  INPUT: Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set,
}

const editableField = (max) =>
  [...document.querySelectorAll(`textarea[maxlength="${max}"], input[maxlength="${max}"]`)]
    .find((el) => isVisible(el) && !el.disabled && !el.readOnly) ?? null

const dropdown = () => x("//h3[text()='Current editing language']/../../div[2]//div[@jsshadow]/div/div")
const languageItems = () => [...(x("//ul[@aria-label='Language']")?.children ?? [])].filter((li) => li.tagName === 'LI')

async function selectLanguage(code) {
  dropdown().click()
  await sleep(WAIT)
  const item = languageItems().find((li) => li.dataset.value === code)
  if (!item) {
    dropdown().click() // close it again
    await sleep(WAIT)
    return false
  }
  item.click()
  await sleep(WAIT)
  return true
}

// delete produces trusted input events, the same ones real typing does
function clear(el) {
  el.focus()
  el.select()
  if (el.value && (!document.execCommand('delete') || el.value)) {
    setters[el.tagName].call(el, '')
    el.dispatchEvent(new InputEvent('input', { bubbles: true }))
  }
  el.dispatchEvent(new Event('change', { bubbles: true }))
  el.blur()
}

const status = (el) => {
  if (!el) return 'NO EDITABLE FIELD'
  return el.value ? 'NOT EMPTY' : 'ok'
}

const button = document.createElement('button')
button.textContent = 'Clear all listings'
button.style = 'position:absolute;top:0;z-index:999;padding:1rem;background:red;color:white'
document.documentElement.append(button)

button.addEventListener('click', async () => {
  button.disabled = true

  dropdown().click()
  await sleep(WAIT)
  const codes = languageItems().map((li) => li.dataset.value)
  dropdown().click()
  await sleep(WAIT)
  console.log(`clearing ${codes.length} languages:`, codes)

  for (const code of codes) {
    if (!(await selectLanguage(code))) continue
    for (const max of [FULL_MAX, SHORT_MAX]) {
      const field = editableField(max)
      if (field) clear(field)
    }
    console.log('cleared:', code)
    await sleep(WAIT)
  }

  // Read back after switching languages, so the value comes from the page's state, not from this write
  const report = []
  for (const code of codes) {
    if (!(await selectLanguage(code))) {
      report.push({ code, full: 'NOT IN DROPDOWN' })
      continue
    }
    report.push({ code, full: status(editableField(FULL_MAX)), short: status(editableField(SHORT_MAX)) })
  }
  console.table(report)
  console.log('done; nothing is stored until "Save draft"')
  button.remove()
})
