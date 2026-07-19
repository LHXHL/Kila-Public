export class StreamPrinter {
  private spinnerTimer: ReturnType<typeof setInterval> | null = null
  private spinnerFrameIndex = 0
  private activeStatusLine: string | null = null
  private lastTextEndedWithNewline = true
  private readonly spinnerFrames = ['|', '/', '-', '\\']

  startLoading(message = 'waiting for first token'): void {
    this.stopLoading()
    this.activeStatusLine = message
    this.renderSpinner()
    this.spinnerTimer = setInterval(() => {
      this.spinnerFrameIndex = (this.spinnerFrameIndex + 1) % this.spinnerFrames.length
      this.renderSpinner()
    }, 80)
  }

  stopLoading(): void {
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer)
      this.spinnerTimer = null
    }
    this.clearStatus()
  }

  setStatus(message: string): void {
    this.activeStatusLine = message
    this.renderStatus(message)
  }

  clearStatus(): void {
    if (!process.stderr.isTTY) return
    process.stderr.write('\r\x1b[2K')
    this.activeStatusLine = null
  }

  printText(text: string): void {
    this.stopLoading()
    process.stdout.write(text)
    this.lastTextEndedWithNewline = text.endsWith('\n')
  }

  ensureTrailingNewline(): void {
    if (!this.lastTextEndedWithNewline) {
      process.stdout.write('\n')
      this.lastTextEndedWithNewline = true
    }
  }

  printInfo(message: string): void {
    this.stopLoading()
    process.stderr.write(`${message}\n`)
  }

  private renderSpinner(): void {
    if (!this.activeStatusLine) return
    this.renderStatus(`${this.spinnerFrames[this.spinnerFrameIndex]} ${this.activeStatusLine}`)
  }

  private renderStatus(message: string): void {
    if (!process.stderr.isTTY) {
      process.stderr.write(`${message}\n`)
      return
    }
    process.stderr.write(`\r\x1b[2K${message}`)
  }
}
