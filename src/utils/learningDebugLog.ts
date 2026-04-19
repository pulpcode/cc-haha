import { mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { getFsImplementation } from './fsOperations.js'
import { jsonStringify } from './slowOperations.js'

export type LearningLogOptions = {
  maxLines?: number
  maxChars?: number
}

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

function truncateLogString(
  formatted: string,
  options: LearningLogOptions,
): string {
  let result = formatted

  if (options.maxLines !== undefined) {
    if (options.maxLines <= 0) return '[truncated]'
    const lines = result.split('\n')
    if (lines.length > options.maxLines) {
      result = `${lines.slice(0, options.maxLines).join('\n')}\n... [truncated ${lines.length - options.maxLines} more lines]`
    }
  }

  if (options.maxChars !== undefined) {
    if (options.maxChars <= 0) return '[truncated]'
    if (result.length > options.maxChars) {
      result = `${result.slice(0, options.maxChars)}... [truncated ${result.length - options.maxChars} more chars]`
    }
  }

  return result
}

export function learningLogLines(value: unknown, maxLines: number): string {
  const formatted = formatArg(value)
  return truncateLogString(formatted, { maxLines })
}

function isLearningLogOptions(value: unknown): value is LearningLogOptions {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const candidate = value as Record<string, unknown>
  const knownKeys = Object.keys(candidate)
  if (knownKeys.length === 0) return false
  if (!knownKeys.every(key => key === 'maxLines' || key === 'maxChars')) {
    return false
  }

  return (
    (candidate.maxLines === undefined ||
      typeof candidate.maxLines === 'number') &&
    (candidate.maxChars === undefined ||
      typeof candidate.maxChars === 'number')
  )
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
  const maybeOptions = args.at(-1)
  const options = isLearningLogOptions(maybeOptions) ? maybeOptions : undefined
  const messageArgs = options ? args.slice(0, -1) : args
  const entry = {
    timestamp: new Date().toISOString(),
    message: truncateLogString(
      formatSlfjMessage(messageTemplate, messageArgs),
      options ?? {},
    ),
  }
  const line = `${jsonStringify(entry)}\n`

  try {
    mkdirSync(dirname(logPath), { recursive: true })
    fs.appendFileSync(logPath, line)
  } catch {
    // Learning logs should never interfere with normal app behavior.
  }
}
