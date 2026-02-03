# AG-UI + PydanticAI Demo

Демо связывает UI на React с агентом на PydanticAI через событийный поток (SSE).

## Запуск backend

```bash
cd /home/dmitry/work/ag-ui-demo/backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Нужен ключ OpenAI или локальный OpenAI-совместимый API (например, Ollama).
# Можно положить переменные в .env (пример: backend/.env.example)
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

- `/api/agent` — основной AG-UI поток (AGUIAdapter).
- `/api/tools` — список backend-инструментов, отображаемых на фронте.
- Инструменты: backend `get_time`, frontend `updateCounter`, `getCounter`.

CopilotKit runtime endpoint: `http://localhost:8000/copilotkit/info`

Источник протокола: https://docs.ag-ui.com/introduction

