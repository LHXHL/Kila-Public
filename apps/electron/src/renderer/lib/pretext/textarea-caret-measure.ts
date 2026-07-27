// Adapted from https://github.com/component/textarea-caret-position
// We use this to compute the pixel coordinates of the caret in a native <textarea>

const properties = [
  'direction', // RTL support
  'boxSizing',
  'width',
  'height',
  'overflowX',
  'overflowY',

  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderStyle',

  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',

  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontSize',
  'fontSizeAdjust',
  'lineHeight',
  'fontFamily',

  'textAlign',
  'textTransform',
  'textIndent',
  'textDecoration',

  'letterSpacing',
  'wordSpacing',

  'tabSize',
  'MozTabSize',
]

const isBrowser = typeof window !== 'undefined'

let mirrorDiv: HTMLDivElement | null = null

export interface CaretCoordinates {
  x: number
  y: number
  height: number
}

export function getTextareaCaretCoords(element: HTMLTextAreaElement, position = element.selectionStart): CaretCoordinates | null {
  if (!isBrowser) return null

  /** camelCase 的 CSS 属性名转 kebab-case，供 setProperty 使用 */
  const toKebabCase = (prop: string): string =>
    prop.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)

  if (!mirrorDiv) {
    mirrorDiv = document.createElement('div')
    mirrorDiv.id = 'input-textarea-caret-position-mirror-div'
    document.body.appendChild(mirrorDiv)
  }

  const style = mirrorDiv.style
  const computed = window.getComputedStyle(element)

  // Default textarea styles
  style.whiteSpace = 'pre-wrap'
  style.wordWrap = 'break-word'

  // Position off-screen
  style.position = 'absolute'
  style.top = '-9999px'
  style.visibility = 'hidden'

  // Transfer textarea properties to mirror div
  properties.forEach((prop) => {
    const val = computed[prop as keyof CSSStyleDeclaration]
    if (val !== undefined && val !== null) {
      // CSSStyleDeclaration 的具名属性都是只读签名，逐个赋值只能走 setProperty
      style.setProperty(toKebabCase(prop), String(val))
    }
  })

  // Firefox workaround
  if (computed.boxSizing === 'border-box') {
    const parseIntSafe = (val: string) => parseInt(val, 10) || 0
    style.width = `${parseIntSafe(computed.width) -
      parseIntSafe(computed.borderLeftWidth) -
      parseIntSafe(computed.borderRightWidth)}px`
    style.padding = `${computed.paddingTop} ${computed.paddingRight} ${computed.paddingBottom} ${computed.paddingLeft}`
    style.border = 'none'
  }

  const textToPos = element.value.substring(0, position)
  // Replaces space before newline with non-breaking space
  const textContent = textToPos.replace(/\s\n/g, ' \n')

  mirrorDiv.textContent = textContent

  const span = document.createElement('span')
  // Append zero-width space so span has correct height even if text box is empty
  span.textContent = element.value.substring(position) || '.'
  mirrorDiv.appendChild(span)

  const coordinates = {
    x: span.offsetLeft + parseInt(computed.borderLeftWidth || '0', 10) - element.scrollLeft,
    y: span.offsetTop + parseInt(computed.borderTopWidth || '0', 10) - element.scrollTop,
    height: parseInt(computed.lineHeight === 'normal' ? computed.fontSize : computed.lineHeight || computed.fontSize || '0', 10) || 20,
  }

  mirrorDiv.innerHTML = ''

  return coordinates
}
