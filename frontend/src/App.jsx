import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { agent, buildUserMessage } from './aguiAgent'

// Базовый префикс API для backend.
const API_BASE = '/api'

// Frontend tool: обновить счетчик (set + delta).
const updateCounterTool = {
  name: 'updateCounter',
  description:
    'Change the counter: value sets an exact number, delta adds or subtracts. You can pass both.',
  parameters: {
    type: 'object',
    properties: {
      value: {
        type: 'number',
        description: 'Exact counter value (optional)',
      },
      delta: {
        type: 'number',
        description: 'Number to add (optional)',
      },
    },
  },
}

// Frontend tool: вернуть текущее значение счетчика.
const getCounterTool = {
  name: 'getCounter',
  description: 'Return the current counter value',
  parameters: {
    type: 'object',
    properties: {},
  },
}

// import { useCopilotAction } from "@copilotkit/react-core"
//
// // Пример CopilotKit tool: обновление счетчика через UI.
// // useCopilotAction({
// //   name: "updateCounter",
// //   description: "Set counter to value and/or change it by delta",
// //   parameters: {
// //     type: "object",
// //     properties: {
// //       value: { type: "number", description: "Exact counter value (optional)" },
// //       delta: { type: "number", description: "Number to add (optional)" },
// //     },
// //   },
// //   handler: async ({ value, delta }) => {
// //     const hasValue = Number.isFinite(value)
// //     const hasDelta = Number.isFinite(delta)
// //     if (!hasValue && !hasDelta) return "no-op"
// //     let nextValue = counter
// //     if (hasValue) nextValue = value
// //     if (hasDelta) nextValue += delta
// //     setCounter(nextValue)
// //     return String(nextValue)
// //   },
// // })



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
  const [counter, setCounter] = useState(0)
  const [status, setStatus] = useState('Готово')
  const [error, setError] = useState('')
  const assistantIdRef = useRef(null)
  const pendingAssistantIdRef = useRef(null)
  const lastUserMessageRef = useRef('')

  // Загружаем backend-инструменты для отображения в UI.
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
        tools: [updateCounterTool, getCounterTool],
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
    [addMessage, extractAgentText]
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

        if (toolCallName === 'updateCounter') {
          // Выполняем frontend tool на клиенте и отсылаем результат.
          const rawValue = toolCallArgs?.value
          const rawDelta = toolCallArgs?.delta
          const hasValue = Number.isFinite(Number(rawValue))
          const hasDelta = Number.isFinite(Number(rawDelta))
          if (!hasValue && !hasDelta) {
            setError('updateCounter: нужен value и/или delta')
            return
          }
          let nextValue = counter
          if (hasValue) {
            nextValue = Number(rawValue)
          }
          if (hasDelta) {
            nextValue += Number(rawDelta)
          }
          setCounter(nextValue)
          addMessage('tool', `(updateCounter) ${counter} → ${nextValue}`)
          await runWithToolResult(String(nextValue), event.toolCallId)
        }

        if (toolCallName === 'getCounter') {
          addMessage('tool', `(getCounter) ${counter}`)
          await runWithToolResult(String(counter), event.toolCallId)
        }
      },
    })

    return () => subscription.unsubscribe()
  }, [addMessage, counter, runWithToolResult])

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
    return 'Вызываются по тексту запроса (например: «сколько времени?»).'
  }, [tools])

  return (
    <div className="app">
      <header className="app__header">
        <h1>AG-UI + PydanticAI Demo</h1>
        <p className="app__subtitle">
          Стриминг событий, инструменты и мок при отсутствии ключа OpenAI.
        </p>
        <div className="app__counter">Счётчик: {counter}</div>
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
            <div className="tools__title">{updateCounterTool.name}</div>
            <div className="tools__desc">{updateCounterTool.description}</div>
            <div className="tools__desc">
              Пример: «обнули счетчик и прибавь 1».
            </div>
          </div>
          <div className="tools__item">
            <div className="tools__title">{getCounterTool.name}</div>
            <div className="tools__desc">{getCounterTool.description}</div>
            <div className="tools__desc">Пример: «какое значение счетчика?».</div>
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
