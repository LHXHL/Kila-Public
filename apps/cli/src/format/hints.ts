export function withHint(message: string, hint: string): string {
  return `${message}\nTry: ${hint}`
}

export function printHint(hint: string): void {
  process.stdout.write(`Hint: ${hint}\n`)
}
