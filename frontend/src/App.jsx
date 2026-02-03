import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { agent, buildUserMessage } from './aguiAgent'

const API_BASE = '/api'

const adjustCounterTool = {
  name: 'adjustCounter',
  description: 'Increase or decrease the counter by a number',
  parameters: {
    type: 'object',
    properties: {
      delta: {
        type: 'number',
        description: 'Positive or negative number to add to the counter',
      },
    },
    required: ['delta'],
  },
}


// import { useCopilotAction } from "@copilotkit/react-core"

// // Define a tool for user confirmation
// useCopilotAction({
//   name: "confirmAction",
//   description: "Ask the user to confirm an action",
//   parameters: {
//     type: "object",
//     properties: {
//       action: {
//         type: "string",
//         description: "The action to confirm",
//       },
//     },
//     required: ["action"],
//   },
//   handler: async ({ action }) => {
//     // Show a confirmation dialog
//     const confirmed = await showConfirmDialog(action)
//     return confirmed ? "approved" : "rejected"
//   },
// })



const createId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`

function App() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [tools, setTools] = useState([])
  const [counter, setCounter] = useState(0)
  const [status, setStatus] = useState('Готово')
  const [error, setError] = useState('')
  const assistantIdRef = useRef(null)
  const pendingAssistantIdRef = useRef(null)
  const lastUserMessageRef = useRef('')

  useEffect(() => {
    const loadTools = async () => {
      try {
        const res = await fetch(`${API_BASE}/tools`)
        const data = await res.json()
        setTools(data.tools || [])
      } catch (err) {
        setError(`Не удалось загрузить инструменты: ${err}`)
      }
    }
    loadTools()
  }, [])

  const addMessage = useCallback((role, content, extra = {}) => {
    const id = createId()
    setMessages((prev) => [...prev, { id, role, content, ...extra }])
    return id
  }, [])


  const extractAgentText = useCallback((runResult) => {
    if (!runResult) return ''
    const last =
      runResult.newMessages?.[runResult.newMessages.length - 1] ||
      runResult.result?.newMessages?.[runResult.result?.newMessages?.length - 1]
    if (last?.content) return String(last.content)
    if (runResult.result) return JSON.stringify(runResult.result)
    return JSON.stringify(runResult)
  }, [])

  const runAgentAndUpdate = useCallback(
    async (assistantId) => {
      const response = await agent.runAgent({
        tools: [adjustCounterTool],
      })
      const awaitingTool = Boolean(response?.result?.awaiting_tool)
      const selectionSource = response?.result?.selection_source
      const text = extractAgentText(response) || 'Ожидаю tool результата...'
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

  const runWithToolResult = useCallback(
    async (result, toolCallId) => {
      const toolMessage = {
        id: createId(),
        role: 'tool',
        content: String(result),
        toolCallId,
      }
      const pendingId = pendingAssistantIdRef.current
      const assistantId =
        pendingId || addMessage('assistant', '', { streaming: true })
      agent.setMessages([buildUserMessage(lastUserMessageRef.current), toolMessage])
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

  useEffect(() => {
    const subscription = agent.subscribe({
      onToolCallEndEvent: async ({ toolCallName, toolCallArgs, event }) => {
        if (!lastUserMessageRef.current) return

        if (toolCallName === 'adjustCounter') {
          const raw = toolCallArgs?.delta
          const delta = Number(raw)
          if (!Number.isFinite(delta)) {
            setError('adjustCounter: delta должен быть числом')
            return
          }
          const nextValue = counter + delta
          setCounter(nextValue)
          addMessage('tool', `(adjustCounter) ${counter} → ${nextValue}`)
          await runWithToolResult(String(nextValue), event.toolCallId)
        }
      },
    })

    return () => subscription.unsubscribe()
  }, [addMessage, counter, runWithToolResult])

  const sendMessage = async ({ message }) => {
    setError('')
    setStatus('Запрос агента...')
    addMessage('user', message)
    const assistantId = addMessage('assistant', '', { streaming: true })
    assistantIdRef.current = assistantId
    lastUserMessageRef.current = message
    pendingAssistantIdRef.current = assistantId

    try {
      agent.setMessages([buildUserMessage(message)])
      await runAgentAndUpdate(assistantIdRef.current)
    } catch (err) {
      setError(String(err))
    } finally {
      setStatus('Готово')
    }
  }

  const handleSend = async () => {
    if (!input.trim()) return
    const message = input.trim()
    setInput('')
    await sendMessage({ message })
  }

  const handleRunTool = async (toolName) => {
    if (toolName !== 'get_time') return
    await sendMessage({ message: '[server_tool] get_time args={}' })
  }

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
            <div className="tools__title">{adjustCounterTool.name}</div>
            <div className="tools__desc">{adjustCounterTool.description}</div>
            <div className="tools__desc">Пример: «увеличь счетчик на 5».</div>
          </div>
          {tools.map((tool) => (
            <div key={tool.name} className="tools__item">
              <div className="tools__title">{tool.name}</div>
              <div className="tools__desc">{tool.description}</div>
              {tool.name === 'get_time' && (
                <button onClick={() => handleRunTool(tool.name)}>
                  Вызвать get_time
                </button>
              )}
            </div>
          ))}

        </aside>
      </section>
    </div>
  )
}

export default App
