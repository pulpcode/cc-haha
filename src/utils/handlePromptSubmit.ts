import type { UUID } from 'crypto'
import { logEvent } from 'src/services/analytics/index.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/services/analytics/metadata.js'
import { type Command, getCommandName, isCommandEnabled } from '../commands.js'
import { selectableUserMessagesFilter } from '../components/MessageSelector.js'
import type { SpinnerMode } from '../components/Spinner/types.js'
import type { QuerySource } from '../constants/querySource.js'
import { expandPastedTextRefs, parseReferences } from '../history.js'
import type { CanUseToolFn } from '../hooks/useCanUseTool.js'
import type { IDESelection } from '../hooks/useIdeSelection.js'
import type { AppState } from '../state/AppState.js'
import type { SetToolJSXFn } from '../Tool.js'
import type { LocalJSXCommandOnDone } from '../types/command.js'
import type { Message } from '../types/message.js'
import {
  isValidImagePaste,
  type PromptInputMode,
  type QueuedCommand,
} from '../types/textInputTypes.js'
import { createAbortController } from './abortController.js'
import type { PastedContent } from './config.js'
import { logForDebugging } from './debug.js'
import type { EffortValue } from './effort.js'
import type { FileHistoryState } from './fileHistory.js'
import { fileHistoryEnabled, fileHistoryMakeSnapshot } from './fileHistory.js'
import { gracefulShutdownSync } from './gracefulShutdown.js'
import { enqueue } from './messageQueueManager.js'
import { resolveSkillModelOverride } from './model/model.js'
import type { ProcessUserInputContext } from './processUserInput/processUserInput.js'
import { processUserInput } from './processUserInput/processUserInput.js'
import type { QueryGuard } from './QueryGuard.js'
import { queryCheckpoint, startQueryProfile } from './queryProfiler.js'
import { runWithWorkload } from './workloadContext.js'
import { logForLearning } from './learningDebugLog.js'

function exit(): void {
  gracefulShutdownSync(0)
}

type BaseExecutionParams = {
  queuedCommands?: QueuedCommand[]
  messages: Message[]
  mainLoopModel: string
  ideSelection: IDESelection | undefined
  querySource: QuerySource
  commands: Command[]
  queryGuard: QueryGuard
  /**
   * True when external loading (remote session, foregrounded background task)
   * is active. These don't route through queryGuard, so the queue check must
   * account for them separately. Omit (defaults to false) for the dequeue path
   * (executeQueuedInput) — dequeued items were already queued past this check.
   */
  isExternalLoading?: boolean
  setToolJSX: SetToolJSXFn
  getToolUseContext: (
    messages: Message[],
    newMessages: Message[],
    abortController: AbortController,
    mainLoopModel: string,
  ) => ProcessUserInputContext
  setUserInputOnProcessing: (prompt?: string) => void
  setAbortController: (abortController: AbortController | null) => void
  onQuery: (
    newMessages: Message[],
    abortController: AbortController,
    shouldQuery: boolean,
    additionalAllowedTools: string[],
    mainLoopModel: string,
    onBeforeQuery?: (input: string, newMessages: Message[]) => Promise<boolean>,
    input?: string,
    effort?: EffortValue,
  ) => Promise<void>
  setAppState: (updater: (prev: AppState) => AppState) => void
  onBeforeQuery?: (input: string, newMessages: Message[]) => Promise<boolean>
  canUseTool?: CanUseToolFn
}

/**
 * Parameters for core execution logic (no UI concerns).
 */
type ExecuteUserInputParams = BaseExecutionParams & {
  resetHistory: () => void
  onInputChange: (value: string) => void
}

export type PromptInputHelpers = {
  setCursorOffset: (offset: number) => void
  clearBuffer: () => void
  resetHistory: () => void
}

export type HandlePromptSubmitParams = BaseExecutionParams & {
  // Direct user input path (set when called from onSubmit, absent for queue processor)
  input?: string
  mode?: PromptInputMode
  pastedContents?: Record<number, PastedContent>
  helpers: PromptInputHelpers
  onInputChange: (value: string) => void
  setPastedContents: React.Dispatch<
    React.SetStateAction<Record<number, PastedContent>>
  >
  abortController?: AbortController | null
  addNotification?: (notification: {
    key: string
    text: string
    priority: 'low' | 'medium' | 'high' | 'immediate'
  }) => void
  setMessages?: (updater: (prev: Message[]) => Message[]) => void
  streamMode?: SpinnerMode
  hasInterruptibleToolInProgress?: boolean
  uuid?: UUID
  /**
   * When true, input starting with `/` is treated as plain text.
   * Used for remotely-received messages (bridge/CCR) that should not
   * trigger local slash commands or skills.
   */
  skipSlashCommands?: boolean
}

//将原始输入变成待执行命令
export async function handlePromptSubmit(
  params: HandlePromptSubmitParams,
): Promise<void> {
  logForLearning("handlePromptSubmit ...")
  //把传进来的 params 对象“拆包”成一堆局部变量，方便后面直接使用
  const {
    helpers,
    queryGuard,
    isExternalLoading = false,
    commands,
    onInputChange,
    setPastedContents,
    setToolJSX,
    getToolUseContext,
    messages,
    mainLoopModel,
    ideSelection,
    setUserInputOnProcessing,
    setAbortController,
    onQuery,
    setAppState,
    onBeforeQuery,
    canUseTool,
    queuedCommands,
    uuid,
    skipSlashCommands,
  } = params

  // logForLearning("messages:{}", messages)

  //helper本质上等于“把输入框相关的几个操作能力打包传进来”
  const { setCursorOffset, clearBuffer, resetHistory } = helpers

  //queuedCommands 是“排队等待执行的命令列表”
  //skipSlashCommands 是一个布尔标记，意思是：
  // * false 或没传：如果输入以 / 开头，就按 slash command 处理
  // * true：即使输入以 / 开头，也当普通文本发给模型，不触发本地命令/技能
  //它主要是给远端桥接消息用的，比如移动端/CCR 发来 /model，不希望本地直接弹命令 UI，而是把它当普通内容处理

  // Queue processor path: commands are pre-validated and ready to execute.
  // Skip all input validation, reference parsing, and queuing logic.
  // 这里是队列处理路径：输入的命令已经过验证，处于待命状态。
  // 此处不执行任何输入检查、语法解析或进入队列的操作，直接运行。
  if (queuedCommands?.length) {
    logForLearning("queue path hit, queued commands: {}", queuedCommands)
    // 开始记这次请求的性能时间线
    startQueryProfile()
    await executeUserInput({
      queuedCommands,
      messages,
      mainLoopModel,
      ideSelection,
      querySource: params.querySource,
      commands,
      queryGuard,
      setToolJSX,
      getToolUseContext,
      setUserInputOnProcessing,
      setAbortController,
      onQuery,
      setAppState,
      onBeforeQuery,
      resetHistory,
      canUseTool,
      onInputChange,
    })
    return
  }

  //用户的实际输入
  const input = params.input ?? ''
  const mode = params.mode ?? 'prompt'
  const rawPastedContents = params.pastedContents ?? {}

  // Images are only sent if their [Image #N] placeholder is still in the text.
  // Deleting the inline pill drops the image; orphaned entries are filtered here.
  const referencedIds = new Set(parseReferences(input).map(r => r.id))
  const pastedContents = Object.fromEntries(
    Object.entries(rawPastedContents).filter(
      ([, c]) => c.type !== 'image' || referencedIds.has(c.id),
    ),
  )

  const hasImages = Object.values(pastedContents).some(isValidImagePaste)
  if (input.trim() === '') {
    return
  }

  // Handle exit commands by triggering the exit command instead of direct process.exit
  // Skip for remote bridge messages — "exit" typed on iOS shouldn't kill the local session
  if (
    !skipSlashCommands &&
    ['exit', 'quit', ':q', ':q!', ':wq', ':wq!'].includes(input.trim())
  ) {
    // Trigger the exit command which will show the feedback dialog
    const exitCommand = commands.find(cmd => cmd.name === 'exit')
    if (exitCommand) {
      // Submit the /exit command instead - recursive call needs to be handled
      void handlePromptSubmit({
        ...params,
        input: '/exit',
      })
    } else {
      // Fallback to direct exit if exit command not found
      exit()
    }
    return
  }

  // 处理粘贴进来的文本引用
  // Parse references and replace with actual content early, before queueing
  // or immediate-command dispatch, so queued commands and immediate commands
  // both receive the expanded text from when it was submitted.
  // 展开占位符，得到真正要提交的输入
  const finalInput = expandPastedTextRefs(input, pastedContents)
  const pastedTextRefs = parseReferences(input).filter(
    r => pastedContents[r.id]?.type === 'text',
  )
  // 统计这次粘贴了多少文本、总字节数是多少
  const pastedTextCount = pastedTextRefs.length
  const pastedTextBytes = pastedTextRefs.reduce(
    (sum, r) => sum + (pastedContents[r.id]?.content.length ?? 0),
    0,
  )
  logEvent('tengu_paste_text', { pastedTextCount, pastedTextBytes })

  // Handle local-jsx immediate commands (e.g., /config, /doctor)
  // Skip for remote bridge messages — slash commands from CCR clients are plain text
  if (!skipSlashCommands && finalInput.trim().startsWith('/')) {
    const trimmedInput = finalInput.trim()
    const spaceIndex = trimmedInput.indexOf(' ')
    const commandName =
      spaceIndex === -1
        ? trimmedInput.slice(1)
        : trimmedInput.slice(1, spaceIndex)
    const commandArgs =
      spaceIndex === -1 ? '' : trimmedInput.slice(spaceIndex + 1).trim()

    const immediateCommand = commands.find(
      cmd =>
        cmd.immediate &&
        isCommandEnabled(cmd) &&
        (cmd.name === commandName ||
          cmd.aliases?.includes(commandName) ||
          getCommandName(cmd) === commandName),
    )

    // local-jsx表示这个命令不是发给模型，也不是跑 shell，而是在本地直接渲染一段 JSX 界面
    // 比如 /model，很可能就是弹一个本地选择器 UI，而不是把 /model 这串字发给 LLM
    // queryGuard 是一个“并发保护器”或者“执行状态锁”。作用是防止同一时间有两次输入执行流程一起跑
    if (
      immediateCommand &&
      immediateCommand.type === 'local-jsx' &&
      (queryGuard.isActive || isExternalLoading)
    ) {
      // 命令是immediateCommand并且local-jsx类型，同时当前系统正忙：queryGuard.isActive || isExternalLoading
      // 那不要把它当普通 prompt 去排队
      logEvent('tengu_immediate_command_executed', {
        commandName:
          immediateCommand.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })

      logForLearning("immediateCommand 忙碌分支")

      // Clear input
      onInputChange('')
      setCursorOffset(0)
      setPastedContents({})
      clearBuffer()

      const context = getToolUseContext(
        messages,
        [],
        createAbortController(),
        mainLoopModel,
      )

      let doneWasCalled = false
      const onDone: LocalJSXCommandOnDone = (result, options) => {
        doneWasCalled = true
        // Use clearLocalJSX to explicitly clear the local JSX command
        setToolJSX({
          jsx: null,
          shouldHidePromptInput: false,
          clearLocalJSX: true,
        })
        if (result && options?.display !== 'skip' && params.addNotification) {
          params.addNotification({
            key: `immediate-${immediateCommand.name}`,
            text: result,
            priority: 'immediate',
          })
        }
        if (options?.nextInput) {
          if (options.submitNextInput) {
            enqueue({ value: options.nextInput, mode: 'prompt' })
          } else {
            onInputChange(options.nextInput)
          }
        }
      }

      const impl = await immediateCommand.load()
      const jsx = await impl.call(onDone, context, commandArgs)

      // Skip if onDone already fired — prevents stuck isLocalJSXCommand
      // (see processSlashCommand.tsx local-jsx case for full mechanism).
      if (jsx && !doneWasCalled) {
        setToolJSX({
          jsx,
          shouldHidePromptInput: false,
          isLocalJSXCommand: true,
          isImmediate: true,
        })
      }
      return
    }
  }

  if (queryGuard.isActive || isExternalLoading) {
    // Only allow prompt and bash mode commands to be queued
    if (mode !== 'prompt' && mode !== 'bash') {
      return
    }

    // Interrupt the current turn when all executing tools have
    // interruptBehavior 'cancel' (e.g. SleepTool).
    if (params.hasInterruptibleToolInProgress) {
      logForDebugging(
        `[interrupt] Aborting current turn: streamMode=${params.streamMode}`,
      )
      logEvent('tengu_cancel', {
        source:
          'interrupt_on_submit' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        streamMode:
          params.streamMode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      params.abortController?.abort('interrupt')
    }

    // 入队
    // Enqueue with string value + raw pastedContents. Images will be resized
    // at execution time when processUserInput runs (not baked in here).
    enqueue({
      value: finalInput.trim(),
      preExpansionValue: input.trim(),
      mode,
      pastedContents: hasImages ? pastedContents : undefined,
      skipSlashCommands,
      uuid,
    })
    /**
     * 消费队列的逻辑在在 useQueueProcessor.ts 和 queueProcessor.ts。
     * 逻辑是：
     * 监听 queryGuard 和队列快照
     * 如果当前没有活跃 query
     * 且队列里有内容
     * 就调用 processQueueIfReady(...)
     */

    onInputChange('')
    setCursorOffset(0)
    setPastedContents({})
    resetHistory()
    clearBuffer()
    return
  }

  // Start query profiling for this query
  startQueryProfile()

  // Construct a QueuedCommand from the direct user input so both paths
  // go through the same executeUserInput loop. This ensures images get
  // resized via processUserInput regardless of how the command arrives.
  const cmd: QueuedCommand = {
    value: finalInput,
    preExpansionValue: input,
    mode,
    pastedContents: hasImages ? pastedContents : undefined,
    skipSlashCommands,
    uuid,
  }

  logForLearning("handlePromptSubmit executeUserInput...cmd={}", cmd)

  await executeUserInput({
    queuedCommands: [cmd],
    messages,
    mainLoopModel,
    ideSelection,
    querySource: params.querySource,
    commands,
    queryGuard,
    setToolJSX,
    getToolUseContext,
    setUserInputOnProcessing,
    setAbortController,
    onQuery,
    setAppState,
    onBeforeQuery,
    resetHistory,
    canUseTool,
    onInputChange,
  })
}

/**
 * Core logic for executing user input without UI side effects.
 *
 * All commands arrive as `queuedCommands`. First command gets full treatment
 * (attachments, ideSelection, pastedContents with image resizing). Commands 2-N
 * get `skipAttachments` to avoid duplicating turn-level context.
 */
async function executeUserInput(params: ExecuteUserInputParams): Promise<void> {
  const {
    messages,
    mainLoopModel,
    ideSelection,
    querySource,
    queryGuard,
    setToolJSX,
    getToolUseContext,
    setUserInputOnProcessing,
    setAbortController,
    onQuery,
    setAppState,
    onBeforeQuery,
    resetHistory,
    canUseTool,
    queuedCommands,
  } = params
  
  // canUseTool不是agent的可用tool列表，而是一个工具权限检查函数
  // logForLearning(
  //   "executeUserInput ... canUseToolType:{} canUseToolName:{} canUseToolPreview:{}",
  //   typeof canUseTool,
  //   typeof canUseTool === 'function' ? canUseTool.name || '(anonymous)' : '',
  //   typeof canUseTool === 'function'
  //     ? Function.prototype.toString.call(canUseTool).slice(0, 240)
  //     : String(canUseTool),
  // )


  // Note: paste references are already processed before calling this function
  // (either in handlePromptSubmit before queuing, or before initial execution).
  // Always create a fresh abort controller — queryGuard guarantees no concurrent
  // executeUserInput call, so there's no prior controller to inherit.
  const abortController = createAbortController()
  setAbortController(abortController)

  function makeContext(): ProcessUserInputContext {
    const makeContextResult = getToolUseContext(messages, [], abortController, mainLoopModel)
    logForLearning("makeContext Result:{}", makeContextResult)
    return makeContextResult
  }

  // Wrap in try-finally so the guard is released even if processUserInput
  // throws or onQuery is skipped. onQuery's finally calls queryGuard.end(),
  // which transitions running→idle; cancelReservation() below is a no-op in
  // that case (only acts on dispatching state).
  try {
    // Reserve the guard BEFORE processUserInput — processBashCommand awaits
    // BashTool.call() and processSlashCommand awaits getMessagesForSlashCommand,
    // so the guard must be active during those awaits to ensure concurrent
    // handlePromptSubmit calls queue (via the isActive check above) instead
    // of starting a second executeUserInput. This call is a no-op if the
    // guard is already in dispatching (legacy queue-processor path).
    queryGuard.reserve()
    queryCheckpoint('query_process_user_input_start')

    const newMessages: Message[] = []
    let shouldQuery = false
    let allowedTools: string[] | undefined
    let model: string | undefined
    let effort: EffortValue | undefined
    let nextInput: string | undefined
    let submitNextInput: boolean | undefined

    // Iterate all commands uniformly. First command gets attachments +
    // ideSelection + pastedContents, rest skip attachments to avoid
    // duplicating turn-level context (IDE selection, todos, diffs).
    const commands = queuedCommands ?? []

    // Compute the workload tag for this turn. queueProcessor can batch a
    // cron prompt with a same-tick human prompt; only tag when EVERY
    // command agrees on the same non-undefined workload — a human in the
    // mix is actively waiting.
    const firstWorkload = commands[0]?.workload
    const turnWorkload =
      firstWorkload !== undefined &&
      commands.every(c => c.workload === firstWorkload)
        ? firstWorkload
        : undefined

    // Wrap the entire turn (processUserInput loop + onQuery) in an
    // AsyncLocalStorage context. This is the ONLY way to correctly
    // propagate workload across await boundaries: void-detached bg agents
    // (executeForkedSlashCommand, AgentTool) capture the ALS context at
    // invocation time, and every await inside them resumes in that
    // context — isolated from the parent's continuation. A process-global
    // mutable slot would be clobbered at the detached closure's first
    // await by this function's synchronous return path. See state.ts.
    await runWithWorkload(turnWorkload, async () => {
      for (let i = 0; i < commands.length; i++) {
        const cmd = commands[i]!
        const isFirst = i === 0
        const result = await processUserInput({
          input: cmd.value,
          preExpansionInput: cmd.preExpansionValue,
          mode: cmd.mode,
          setToolJSX,
          context: makeContext(),
          pastedContents: isFirst ? cmd.pastedContents : undefined,
          messages,
          setUserInputOnProcessing: isFirst
            ? setUserInputOnProcessing
            : undefined,
          isAlreadyProcessing: !isFirst,
          querySource,
          canUseTool,
          uuid: cmd.uuid,
          ideSelection: isFirst ? ideSelection : undefined,
          skipSlashCommands: cmd.skipSlashCommands,
          bridgeOrigin: cmd.bridgeOrigin,
          isMeta: cmd.isMeta,
          skipAttachments: !isFirst,
        })
        // Stamp origin here rather than threading another arg through
        // processUserInput → processUserInputBase → processTextPrompt → createUserMessage.
        // Derive origin from mode for task-notifications — mirrors the origin
        // derivation at messages.ts (case 'queued_command'); intentionally
        // does NOT mirror its isMeta:true so idle-dequeued notifications stay
        // visible in the transcript via UserAgentNotificationMessage.
        const origin =
          cmd.origin ??
          (cmd.mode === 'task-notification'
            ? ({ kind: 'task-notification' } as const)
            : undefined)
        if (origin) {
          for (const m of result.messages) {
            if (m.type === 'user') m.origin = origin
          }
        }
        newMessages.push(...result.messages)
        if (isFirst) {
          shouldQuery = result.shouldQuery
          allowedTools = result.allowedTools
          model = result.model
          effort = result.effort
          nextInput = result.nextInput
          submitNextInput = result.submitNextInput
        }
      }

      queryCheckpoint('query_process_user_input_end')
      if (fileHistoryEnabled()) {
        queryCheckpoint('query_file_history_snapshot_start')
        newMessages.filter(selectableUserMessagesFilter).forEach(message => {
          void fileHistoryMakeSnapshot(
            (updater: (prev: FileHistoryState) => FileHistoryState) => {
              setAppState(prev => ({
                ...prev,
                fileHistory: updater(prev.fileHistory),
              }))
            },
            message.uuid,
          )
        })
        queryCheckpoint('query_file_history_snapshot_end')
      }

      if (newMessages.length) {
        // History is now added in the caller (onSubmit) for direct user submissions.
        // This ensures queued command processing (notifications, already-queued user input)
        // doesn't add to history, since those either shouldn't be in history or were
        // already added when originally queued.
        resetHistory()
        setToolJSX({
          jsx: null,
          shouldHidePromptInput: false,
          clearLocalJSX: true,
        })

        const primaryCmd = commands[0]
        const primaryMode = primaryCmd?.mode ?? 'prompt'
        const primaryInput =
          primaryCmd && typeof primaryCmd.value === 'string'
            ? primaryCmd.value
            : undefined
        const shouldCallBeforeQuery = primaryMode === 'prompt'
        await onQuery(
          newMessages,
          abortController,
          shouldQuery,
          allowedTools ?? [],
          model
            ? resolveSkillModelOverride(model, mainLoopModel)
            : mainLoopModel,
          shouldCallBeforeQuery ? onBeforeQuery : undefined,
          primaryInput,
          effort,
        )
      } else {
        // Local slash commands that skip messages (e.g., /model, /theme).
        // Release the guard BEFORE clearing toolJSX to prevent spinner flash —
        // the spinner formula checks: (!toolJSX || showSpinner) && isLoading.
        // If we clear toolJSX while the guard is still reserved, spinner briefly
        // shows. The finally below also calls cancelReservation (no-op if idle).
        queryGuard.cancelReservation()
        setToolJSX({
          jsx: null,
          shouldHidePromptInput: false,
          clearLocalJSX: true,
        })
        resetHistory()
        setAbortController(null)
      }

      // Handle nextInput from commands that want to chain (e.g., /discover activation)
      if (nextInput) {
        if (submitNextInput) {
          enqueue({ value: nextInput, mode: 'prompt' })
        } else {
          params.onInputChange(nextInput)
        }
      }
    }) // end runWithWorkload — ALS context naturally scoped, no finally needed
  } finally {
    // Safety net: release the guard reservation if processUserInput threw
    // or onQuery was skipped. No-op if onQuery already ran (guard is idle
    // via end(), or running — cancelReservation only acts on dispatching).
    // This is the single source of truth for releasing the reservation;
    // useQueueProcessor no longer needs its own .finally().
    queryGuard.cancelReservation()
    // Safety net: clear the placeholder if processUserInput produced no
    // messages or threw — otherwise it would stay visible until the next
    // turn's resetLoadingState. Harmless when onQuery ran: setMessages grew
    // displayedMessages past the baseline, so REPL.tsx already hid it.
    setUserInputOnProcessing(undefined)
  }
}
