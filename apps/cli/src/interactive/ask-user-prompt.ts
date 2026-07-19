import { createInterface } from 'node:readline/promises'
import type { AskUserRequest, CliAskUserResponseRequest } from '@kila/shared'

async function ask(prompt: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  })

  try {
    return (await rl.question(prompt)).trim()
  } finally {
    rl.close()
  }
}

export async function promptForAskUser(
  request: AskUserRequest,
): Promise<CliAskUserResponseRequest> {
  const answers: Record<string, string> = {}
  process.stderr.write('\n[ask-user]\n')

  for (let index = 0; index < request.questions.length; index += 1) {
    const question = request.questions[index]!
    process.stderr.write(`${question.header ? `${question.header}: ` : ''}${question.question}\n`)
    for (let optionIndex = 0; optionIndex < question.options.length; optionIndex += 1) {
      const option = question.options[optionIndex]!
      process.stderr.write(`  ${optionIndex + 1}. ${option.label}${option.description ? ` — ${option.description}` : ''}\n`)
    }

    const prompt = question.multiSelect
      ? 'Answer (comma-separated option numbers or free text): '
      : 'Answer (option number or free text): '
    const rawAnswer = await ask(prompt)

    if (rawAnswer && /^[\d,\s]+$/.test(rawAnswer)) {
      const selectedLabels = rawAnswer
        .split(',')
        .map((part) => Number(part.trim()))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => question.options[value - 1]?.label)
        .filter((value): value is string => Boolean(value))

      answers[String(index)] = question.multiSelect
        ? selectedLabels.join(', ')
        : (selectedLabels[0] ?? '')
      continue
    }

    answers[String(index)] = rawAnswer
  }

  return {
    requestId: request.requestId,
    answers,
  }
}
