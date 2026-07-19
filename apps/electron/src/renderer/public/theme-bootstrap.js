// 在 React 加载前恢复主题，避免首帧闪烁。
;(function bootstrapTheme() {
  var mode = localStorage.getItem('kila-theme-mode') || 'light'
  var themeId = localStorage.getItem('kila-theme-id') || 'porcelain'
  var bootstrapCss = localStorage.getItem('kila-theme-bootstrap-css')
  if (mode === 'dark') {
    document.documentElement.classList.add('dark')
  } else if (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.classList.add('dark')
  }
  if (themeId && bootstrapCss) {
    var style = document.createElement('style')
    style.id = 'kila-theme'
    style.textContent = bootstrapCss
    document.head.appendChild(style)
  }
})()
