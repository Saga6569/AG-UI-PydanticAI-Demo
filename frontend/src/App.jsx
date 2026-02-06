import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCopilotAction } from '@copilotkit/react-core'
import './App.css'
import { agent, buildUserMessage } from './aguiAgent'

// Базовый префикс API для backend.
const API_BASE = '/api'

const AVAILABLE_THEMES = ['light', 'dark', 'blue', 'solarized']

const UPDATE_DEMO_STATE_PARAMS = [
  {
    name: 'count',
    type: 'number',
    description: 'Exact counter value (optional)',
    required: false,
  },
  {
    name: 'delta',
    type: 'number',
    description: 'Number to add to count (optional)',
    required: false,
  },
  {
    name: 'step',
    type: 'number',
    description: 'Step value (optional)',
    required: false,
  },
  {
    name: 'label',
    type: 'string',
    description: 'Label for the demo state (optional)',
    required: false,
  },
  {
    name: 'theme',
    type: 'string',
    description: 'Theme name (optional)',
    enum: AVAILABLE_THEMES,
    required: false,
  },
]

const buildJsonSchemaFromCopilotParams = (parameters = []) => {
  const properties = {}
  const required = []
  parameters.forEach((param) => {
    const { name, type = 'string', description, enum: enumValues, required: isRequired } =
      param
    const schema = { type: 'string' }
    if (type.endsWith('[]')) {
      const itemType = type.replace('[]', '')
      schema.type = 'array'
      schema.items = { type: itemType }
    } else {
      schema.type = type
    }
    if (description) schema.description = description
    if (Array.isArray(enumValues)) schema.enum = enumValues
    properties[name] = schema
    if (isRequired !== false) required.push(name)
  })
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  }
}

const toAgUiTool = (action) => ({
  name: action.name,
  description: action.description,
  parameters: buildJsonSchemaFromCopilotParams(action.parameters || []),
})



// Утилита генерации ID для сообщений.
const createId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`

function App() {
  // Состояние UI чата и инструментов.
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [tools, setTools] = useState([])
  const [demoState, setDemoState] = useState({
    count: 0,
    step: 1,
    label: 'Демо',
    theme: 'dark',
  })
  const [status, setStatus] = useState('Готово')
  const [error, setError] = useState('')
  const assistantIdRef = useRef(null)
  const pendingAssistantIdRef = useRef(null)
  const lastUserMessageRef = useRef('')

  const normalizeTheme = useCallback((value) => {
    if (typeof value !== 'string') return null
    const normalized = value.trim().toLowerCase()
    return AVAILABLE_THEMES.includes(normalized) ? normalized : null
  }, [])

  const buildDemoStateUpdate = useCallback(
    (baseState, args = {}) => {
      const rawCount = args.count
      const rawDelta = args.delta
      const rawStep = args.step
      const rawLabel = args.label
      const rawTheme = args.theme
      const hasCount = Number.isFinite(Number(rawCount))
      const hasDelta = Number.isFinite(Number(rawDelta))
      const hasStep = Number.isFinite(Number(rawStep))
      const hasLabel = typeof rawLabel === 'string' && rawLabel.trim().length > 0
      const normalizedTheme = normalizeTheme(rawTheme)
      const hasTheme = Boolean(normalizedTheme)
      const changed = hasCount || hasDelta || hasStep || hasLabel || hasTheme
      const nextState = { ...baseState }
      if (hasCount) {
        nextState.count = Number(rawCount)
      }
      if (hasDelta) {
        nextState.count += Number(rawDelta)
      }
      if (hasStep) {
        nextState.step = Number(rawStep)
      }
      if (hasLabel) {
        nextState.label = rawLabel.trim()
      }
      if (hasTheme) {
        nextState.theme = normalizedTheme
      }
      return { nextState, changed }
    },
    [normalizeTheme]
  )

  const applyDemoStateUpdate = useCallback(
    (args = {}) => {
      const { nextState, changed } = buildDemoStateUpdate(demoState, args)
      if (changed) {
        setDemoState(nextState)
      }
      return { nextState, changed }
    },
    [buildDemoStateUpdate, demoState]
  )

  const updateDemoStateAction = useMemo(
    () => ({
      name: 'updateDemoState',
      description:
        'Update demo state: count sets exact value, delta adds/subtracts, step updates step, label updates label, theme updates theme. Any field is optional.',
      parameters: UPDATE_DEMO_STATE_PARAMS,
      handler: async ({ count, delta, step, label, theme }) => {
        const { nextState } = applyDemoStateUpdate({
          count,
          delta,
          step,
          label,
          theme,
        })
        return JSON.stringify(nextState)
      },
    }),
    [applyDemoStateUpdate]
  )

  const getDemoStateAction = useMemo(
    () => ({
      name: 'getDemoState',
      description: 'Return the current demo state',
      handler: async () => JSON.stringify(demoState),
    }),
    [demoState]
  )

  const getAvailableThemesAction = useMemo(
    () => ({
      name: 'getAvailableThemes',
      description: 'Return available theme names',
      handler: async () => JSON.stringify(AVAILABLE_THEMES),
    }),
    []
  )

  useCopilotAction(updateDemoStateAction, [applyDemoStateUpdate])
  useCopilotAction(getDemoStateAction, [demoState])
  useCopilotAction(getAvailableThemesAction)

  const frontendTools = useMemo(
    () => [
      toAgUiTool(updateDemoStateAction),
      toAgUiTool(getDemoStateAction),
      toAgUiTool(getAvailableThemesAction),
    ],
    [updateDemoStateAction, getDemoStateAction, getAvailableThemesAction]
  )

  // Загружаем backend-инструменты для отображения в UI.
  useEffect(() => {
    const root = document.getElementById('root')
    if (root) {
      root.setAttribute('data-theme', demoState.theme)
    }
  }, [demoState.theme])

  useEffect(() => {
    const loadTools = async () => {
      try {
        const res = await fetch(`${API_BASE}/tools`)
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        const text = await res.text()
        if (!text) {
          throw new Error('Пустой ответ от сервера')
        }
        const data = JSON.parse(text)
        setTools(Array.isArray(data.tools) ? data.tools : [])
      } catch (err) {
        setError(`Не удалось загрузить инструменты: ${err}`)
      }
    }
    loadTools()
  }, [])

  // Добавляет сообщение в локальный список чата.
  const addMessage = useCallback((role, content, extra = {}) => {
    const id = createId()
    setMessages((prev) => [...prev, { id, role, content, ...extra }])
    return id
  }, [])


  // Извлекаем текст для отображения из результата run.
  const extractAgentText = useCallback((runResult, agentMessages = []) => {
    if (!runResult) return ''
    const newMessages = runResult.newMessages || runResult.result?.newMessages || []
    const lastAssistant = [...newMessages].reverse().find((msg) => msg.role === 'assistant')
    if (lastAssistant?.content) return String(lastAssistant.content)

    const lastTool = [...newMessages].reverse().find((msg) => msg.role === 'tool')
    if (lastTool?.content) return `Результат инструмента: ${String(lastTool.content)}`

    const lastFromAgent = [...agentMessages].reverse().find((msg) => msg.content)
    if (lastFromAgent?.content && lastFromAgent.role === 'tool') {
      return `Результат инструмента: ${String(lastFromAgent.content)}`
    }
    if (lastFromAgent?.content) return String(lastFromAgent.content)

    if (runResult.result) return JSON.stringify(runResult.result)
    return JSON.stringify(runResult)
  }, [])

  // Запускаем run и обновляем ассистентское сообщение.
  const runAgentAndUpdate = useCallback(
    async (assistantId) => {
      // Запуск AG-UI run: отдаём фронтовые tools и ждём результата.
      const response = await agent.runAgent({
        tools: frontendTools,
      })
      const awaitingTool = Boolean(response?.result?.awaiting_tool)
      const selectionSource = response?.result?.selection_source
      const text =
        extractAgentText(response, agent.messages) || 'Ожидаю tool результата...'
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantId
            ? { ...msg, content: text, streaming: false }
            : msg
        )
      )
      if (awaitingTool) {
        pendingAssistantIdRef.current = assistantId
      } else {
        pendingAssistantIdRef.current = null
      }
      if (selectionSource && selectionSource !== 'none') {
        addMessage('status', `tool selection: ${selectionSource}`)
      }
    },
    [addMessage, extractAgentText, frontendTools]
  )

  // Отправляем результат frontend tool и получаем финальный ответ.
  const runWithToolResult = useCallback(
    async (result, toolCallId) => {
      // Отправляем результат frontend tool обратно в агент.
      const toolMessage = {
        id: createId(),
        role: 'tool',
        content: String(result),
        toolCallId,
      }
      const pendingId = pendingAssistantIdRef.current
      const assistantId =
        pendingId || addMessage('assistant', '', { streaming: true })
      agent.addMessage(toolMessage)
      try {
        await runAgentAndUpdate(assistantId)
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id !== assistantId) return msg
            if (
              !msg.content ||
              msg.content.trim() === '' ||
              msg.content === 'Ожидаю tool результата...'
            ) {
              return {
                ...msg,
                content: `Результат инструмента: ${String(result)}`,
              }
            }
            return msg
          })
        )
      } catch (err) {
        setError(String(err))
      } finally {
        pendingAssistantIdRef.current = null
      }
    },
    [addMessage, runAgentAndUpdate]
  )

  // Подписка на tool-вызовы со стороны агента.
  useEffect(() => {
    const subscription = agent.subscribe({
      onToolCallEndEvent: async ({ toolCallName, toolCallArgs, event }) => {
        if (!lastUserMessageRef.current) return

        if (toolCallName === 'updateDemoState') {
          // Выполняем frontend tool на клиенте и отсылаем результат.
          const prevState = demoState
          const { nextState, changed } = applyDemoStateUpdate(
            toolCallArgs || {}
          )
          if (!changed) {
            addMessage('tool', '(updateDemoState) no-op')
            await runWithToolResult(JSON.stringify(prevState), event.toolCallId)
            return
          }
          addMessage(
            'tool',
            `(updateDemoState) count: ${prevState.count} → ${nextState.count}, step=${nextState.step}, label="${nextState.label}", theme=${nextState.theme}`
          )
          await runWithToolResult(JSON.stringify(nextState), event.toolCallId)
        }

        if (toolCallName === 'getDemoState') {
          addMessage('tool', `(getDemoState) ${JSON.stringify(demoState)}`)
          await runWithToolResult(JSON.stringify(demoState), event.toolCallId)
        }

        if (toolCallName === 'getAvailableThemes') {
          const payload = JSON.stringify(AVAILABLE_THEMES)
          addMessage('tool', `(getAvailableThemes) ${AVAILABLE_THEMES.join(', ')}`)
          await runWithToolResult(payload, event.toolCallId)
        }
      },
    })

    return () => subscription.unsubscribe()
  }, [addMessage, applyDemoStateUpdate, demoState, runWithToolResult])

  // Отправка сообщения пользователя и запуск run.
  const sendMessage = async ({ message }) => {
    setError('')
    setStatus('Запрос агента...')
    addMessage('user', message)
    const assistantId = addMessage('assistant', '', { streaming: true })
    assistantIdRef.current = assistantId
    lastUserMessageRef.current = message
    pendingAssistantIdRef.current = assistantId

    try {
      agent.addMessage(buildUserMessage(message))
      await runAgentAndUpdate(assistantIdRef.current)
    } catch (err) {
      setError(String(err))
    } finally {
      setStatus('Готово')
    }
  }

  // Обработчик клика по кнопке отправки.
  const handleSend = async () => {
    if (!input.trim()) return
    const message = input.trim()
    setInput('')
    await sendMessage({ message })
  }

  // Текст подсказки в боковой панели инструментов.
  const toolHint = useMemo(() => {
    if (!tools.length) return 'Инструменты не загружены.'
    return 'Вызываются по тексту запроса (например: «какие темы доступны?»).'
  }, [tools])

  return (
    <div className="app">
      <header className="app__header">
        <h1>AG-UI + PydanticAI Demo</h1>
        <p className="app__subtitle">
          Стриминг событий, инструменты и мок при отсутствии ключа OpenAI.
        </p>
        <div className="app__counter">
          Состояние: count={demoState.count}, step={demoState.step}, label=
          {demoState.label}, theme={demoState.theme}
        </div>
      </header>

      <section className="app__panel">
        <div className="chat">
          <div className="chat__messages">
            {messages.map((msg) => (
              <div key={msg.id} className={`chat__message chat__message--${msg.role}`}>
                <span className="chat__role">{msg.role}</span>
                <p>{msg.content}</p>
              </div>
            ))}
          </div>
          <div className="chat__input">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Введите сообщение..."
            />
            <button onClick={handleSend}>Send</button>
          </div>
          <div className="chat__status">
            <span>{status}</span>
            {error && <span className="chat__error">{error}</span>}
          </div>
        </div>

        <aside className="tools">
          <h2>Tools</h2>
          <p className="tools__hint">{toolHint}</p>
          <div className="tools__item">
            <div className="tools__title">{updateDemoStateAction.name}</div>
            <div className="tools__desc">{updateDemoStateAction.description}</div>
            <div className="tools__desc">
              Пример: «установи count в 10, шаг 2, label "быстро", theme "solarized"».
            </div>
          </div>
          <div className="tools__item">
            <div className="tools__title">{getDemoStateAction.name}</div>
            <div className="tools__desc">{getDemoStateAction.description}</div>
            <div className="tools__desc">Пример: «покажи состояние».</div>
          </div>
          <div className="tools__item">
            <div className="tools__title">{getAvailableThemesAction.name}</div>
            <div className="tools__desc">{getAvailableThemesAction.description}</div>
            <div className="tools__desc">
              Пример: «какие темы доступны?».
            </div>
          </div>
          {tools.map((tool) => (
            <div key={tool.name} className="tools__item">
              <div className="tools__title">{tool.name}</div>
              <div className="tools__desc">{tool.description}</div>
            </div>
          ))}

        </aside>
      </section>
    </div>
  )
}

export default App
