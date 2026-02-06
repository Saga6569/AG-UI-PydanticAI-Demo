from __future__ import annotations

import json
import uuid
from typing import Any, Dict

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic_ai.ui.ag_ui import AGUIAdapter

from .agent import get_agent
from .sse import format_sse
from .tools import TOOLS, get_time


# Загружаем переменные окружения для модели (OPENAI_* и т.п.).
load_dotenv(override=True)

# Основное ASGI-приложение.
app = FastAPI(title="AG-UI + PydanticAI Demo")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> Dict[str, str]:
    # Простой health-check, чтобы убедиться что сервер жив.
    return {"status": "ok"}


def _copilotkit_runtime_info() -> Dict[str, Any]:
    # Минимальный ответ runtime, чтобы CopilotKit мог подключиться.
    # Формат соответствует RuntimeInfo из @copilotkitnext/shared.
    return {
        "version": "0.0.0",
        "agents": {
            "default": {
                "name": "default",
                "className": "DemoAgent",
                "description": "Default demo agent",
            }
        },
        "audioFileTranscriptionEnabled": False,
    }


@app.get("/copilotkit")
@app.post("/copilotkit")
async def copilotkit_root(request: Request) -> Dict[str, Any]:
    # CopilotKit может слать POST на runtimeUrl с { method: "info" }.
    # Возвращаем info для любого POST, чтобы избежать ошибок синхронизации.
    if request.method == "POST":
        return _copilotkit_runtime_info()
    return {"status": "ok"}


@app.get("/copilotkit/info")
@app.post("/copilotkit/info")
def copilotkit_info() -> Dict[str, Any]:
    return _copilotkit_runtime_info()


@app.get("/api/tools")
def list_tools() -> Dict[str, Any]:
    # Отдаём backend-инструменты для отображения на фронте.
    # Эти описания нужны UI и модели для выбора tool.
    return {
        "tools": [
            {
                "name": tool.name,
                "description": tool.description,
                "input_schema": tool.input_schema,
            }
            for tool in TOOLS
        ]
    }


@app.post("/api/agent")
async def run_agent(request: Request) -> Response:
    # Основной AG-UI эндпоинт: принимает RunAgentInput и стримит AG-UI события.
    agent = get_agent()
    raw_body = await request.body()
    payload: Dict[str, Any] = {}
    try:
        payload = json.loads(raw_body.decode("utf-8") or "{}")
    except Exception:
        payload = {}
    # Иногда клиенты присылают служебное поле "format", которого нет в схеме.
    payload.pop("format", None)

    def _needs_time_tool(data: Dict[str, Any]) -> bool:
        # Простейшая эвристика: вопрос про "время" отдаем серверным fallback.
        for message in reversed(data.get("messages", []) or []):
            if message.get("role") == "user":
                content = str(message.get("content", "")).lower()
                return "время" in content or "time" in content
        return False

    if _needs_time_tool(payload):
        # Fallback: для вопросов о времени возвращаем ответ без модели.
        # Это нужно, если локальная модель не делает tool-calling.
        thread_id = payload.get("threadId") or str(uuid.uuid4())
        run_id = payload.get("runId") or str(uuid.uuid4())
        assistant_message_id = str(uuid.uuid4())
        time_text = f"Текущее время (UTC): {get_time()}"

        async def event_stream():
            # Эмулируем стандартный AG-UI стрим событий.
            yield format_sse(
                "message",
                {
                    "type": "RUN_STARTED",
                    "threadId": thread_id,
                    "runId": run_id,
                    "input": payload,
                },
            )
            yield format_sse(
                "message",
                {
                    "type": "TEXT_MESSAGE_START",
                    "messageId": assistant_message_id,
                    "role": "assistant",
                },
            )
            yield format_sse(
                "message",
                {
                    "type": "TEXT_MESSAGE_CONTENT",
                    "messageId": assistant_message_id,
                    "delta": time_text,
                },
            )
            yield format_sse(
                "message",
                {
                    "type": "TEXT_MESSAGE_END",
                    "messageId": assistant_message_id,
                },
            )
            yield format_sse(
                "message",
                {
                    "type": "RUN_FINISHED",
                    "threadId": thread_id,
                    "runId": run_id,
                    "result": {"source": "server_fallback"},
                },
            )

        return StreamingResponse(event_stream(), media_type="text/event-stream")

    # Обычный путь: даём AGUIAdapter обработать запрос и стримить события.
    accept = request.headers.get("accept")
    run_input = AGUIAdapter.build_run_input(json.dumps(payload).encode("utf-8"))
    adapter = AGUIAdapter(agent=agent, run_input=run_input, accept=accept)
    response = adapter.streaming_response(adapter.run_stream())
    if hasattr(response, "__await__"):
        response = await response  # type: ignore[assignment]
    return response

