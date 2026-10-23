/**
 * A phone's keyboard covers the bottom of the page without making it any shorter, so a sheet
 * sized to the screen would hide its toolbar behind the keyboard. This keeps --vv-height and
 * --vv-top in step with the part of the screen that's actually visible, and marks the page
 * with data-keyboard while a keyboard is open, so the editor can sit just above it.
 */
export function trackVisualViewport() {
  const vv = window.visualViewport
  if (!vv) return
  const root = document.documentElement
  const update = () => {
    root.style.setProperty('--vv-height', `${vv.height}px`)
    root.style.setProperty('--vv-top', `${vv.offsetTop}px`)
    // Anything much shorter than the window is a keyboard, not a toolbar sliding away.
    if (window.innerHeight - vv.height > 120) root.dataset.keyboard = ''
    else delete root.dataset.keyboard
  }
  update()
  vv.addEventListener('resize', update)
  vv.addEventListener('scroll', update)
}
