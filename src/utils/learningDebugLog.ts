import { mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { getFsImplementation } from './fsOperations.js'
import { jsonStringify } from './slowOperations.js'

function getLearningDebugLogPath(): string {
  return (
    process.env.CLAUDE_CODE_LEARNING_DEBUG_FILE ??
    join(getClaudeConfigHomeDir(), 'learning-debug.log')
  )
}

function formatArg(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return jsonStringify(value)
  } catch {
    return String(value)
  }
}

function formatSlfjMessage(messageTemplate: string, args: unknown[]): string {
  let index = 0
  const message = messageTemplate.replaceAll("{}", () => {
    if (index >= args.length) return '{}'
    const value = formatArg(args[index])
    index += 1
    return value
  })

  if (index >= args.length) return message

  return `${message} ${args.slice(index).map(formatArg).join(' ')}`
}

export function logForLearning(messageTemplate: string, ...args: unknown[]): void {
  const fs = getFsImplementation()
  const logPath = getLearningDebugLogPath()
  const entry = {
    timestamp: new Date().toISOString(),
    message: formatSlfjMessage(messageTemplate, args),
  }
  const line = `${jsonStringify(entry)}\n`

  try {
    mkdirSync(dirname(logPath), { recursive: true })
    fs.appendFileSync(logPath, line)
  } catch {
    // Learning logs should never interfere with normal app behavior.
  }
}
