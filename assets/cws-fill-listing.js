// Fills the Chrome Web Store listing from apps/extension/public/_locales.
// Paste into the DevTools console on the item's "Store listing" page, then pick the _locales folder
// with the button that appears. Click "Save draft" afterwards; the script does not save.
// The dropdown lists only the languages of the uploaded package, so upload the current build first.

const MODE = 'write'        // 'write' overwrites the fields, 'check' only reads them
const ONLY = ['de', 'fr']   // store codes to process; [] means all languages
const WAIT = 1200
const SHORT_MAX = 132
const FULL_MAX = 16000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const x = (p) => document.evaluate(p, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
const norm = (s) => s.replace(/\r\n/g, '\n').trim()
const isVisible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
const setters = {
  TEXTAREA: Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set,
  INPUT: Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set,
}

const editableField = (max) =>
  [...document.querySelectorAll(`textarea[maxlength="${max}"], input[maxlength="${max}"]`)]
    .find((el) => isVisible(el) && !el.disabled && !el.readOnly) ?? null

function dumpFields() {
  console.table([...document.querySelectorAll('textarea, input:not([type]), input[type=text]')].map((el) => ({
    tag: el.tagName,
    maxlength: el.getAttribute('maxlength'),
    visible: isVisible(el),
    disabled: el.disabled,
    readOnly: el.readOnly,
    label: el.getAttribute('aria-label'),
    length: [...el.value].length,
  })))
}

async function selectLanguage(code) {
  const dropdown = x("//h3[text()='Current editing language']/../../div[2]//div[@jsshadow]/div/div")
  dropdown.click()
  await sleep(WAIT)
  const item = [...(x("//ul[@aria-label='Language']")?.children ?? [])].find((li) => li.dataset.value === code)
  if (!item) {
    dropdown.click() // close it again
    await sleep(WAIT)
    return false
  }
  item.click()
  await sleep(WAIT)
  return true
}

// insertText produces trusted input events, the same ones real typing does
function fill(el, text) {
  el.focus()
  el.select()
  const inserted = document.execCommand('insertText', false, text)
  if (!inserted || norm(el.value) !== norm(text)) {
    setters[el.tagName].call(el, text)
    el.dispatchEvent(new InputEvent('input', { bubbles: true }))
  }
  el.dispatchEvent(new Event('change', { bubbles: true }))
  el.blur()
  return inserted ? 'typed' : 'set'
}

const compare = (el, want) => {
  if (!el) return 'NO EDITABLE FIELD'
  if (norm(el.value) === norm(want)) return 'ok'
  return el.value ? 'DIFFERENT' : 'EMPTY'
}

const picker = document.createElement('input')
picker.type = 'file'
picker.webkitdirectory = true
picker.multiple = true
picker.style = 'position:absolute;top:0;z-index:999;padding:1rem;background:green'
document.documentElement.append(picker)

picker.addEventListener('change', async (event) => {
  const locales = {}
  for (const f of event.target.files) {
    if (f.name !== 'messages.json') continue
    const parts = f.webkitRelativePath.split('/')
    let code = parts[parts.length - 2].replace('_', '-')
    if (code === 'he') code = 'iw'
    const json = JSON.parse(await f.text())
    locales[code] = { short: json.shortDesc.message, full: json.storeDesc.message }
  }
  const codes = ONLY.length ? ONLY.filter((c) => c in locales) : Object.keys(locales)
  console.log(`${MODE}: ${codes.length} of ${Object.keys(locales).length} languages`)
  dumpFields()

  const writes = {}
  if (MODE === 'write') {
    for (const code of codes) {
      if (!(await selectLanguage(code))) continue
      const full = editableField(FULL_MAX)
      const short = editableField(SHORT_MAX)
      writes[code] = {
        full: full ? fill(full, locales[code].full) : 'no field',
        short: short ? fill(short, locales[code].short) : 'no field',
      }
      console.log('written:', code, writes[code])
      await sleep(WAIT)
    }
  }

  // Read back after switching languages, so the value comes from the page's state, not from this write
  const report = []
  for (const code of codes) {
    if (!(await selectLanguage(code))) {
      report.push({ code, full: 'NOT IN DROPDOWN' })
      continue
    }
    const full = editableField(FULL_MAX)
    report.push({
      code,
      full: compare(full, locales[code].full),
      have: full ? [...full.value].length : null,
      want: [...locales[code].full].length,
      short: compare(editableField(SHORT_MAX), locales[code].short),
      wrote: writes[code]?.full,
    })
  }
  console.table(report)
})
