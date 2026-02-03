# AG-UI + PydanticAI Demo

Демо связывает UI на React с агентом на PydanticAI через событийный поток (SSE).

## Запуск backend

```bash
cd /home/dmitry/work/ag-ui-demo/backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Если ключ есть — будет OpenAI, если нет/ошибка — мок
# Можно положить переменные в .env (пример: backend/env.example.txt)
export OPENAI_API_KEY="..."
export OPENAI_MODEL="gpt-4o-mini"

uvicorn app.main:app --reload --port 8000
```

## Запуск frontend

```bash
cd /home/dmitry/work/ag-ui-demo/frontend
npm install
npm run dev
```

Открой `http://localhost:5173`.

## Что внутри

- `/api/chat/stream` — SSE поток событий.
- `/api/tools` — список инструментов, отображаемых на фронте.
- Инструменты: `get_time`, `roll_dice`, `add`.

События похожи на AG-UI стиль: `session_started`, `tool_call`, `tool_result`,
`message_delta`, `message_completed`, `warning`, `error`.

CopilotKit runtime endpoint: `http://localhost:8000/copilotkit/info`

Источник протокола: https://docs.ag-ui.com/introduction

