from __future__ import annotations

import asyncio
from dotenv import load_dotenv
import uuid
import json
from typing import Any, Dict, Optional, Tuple

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .agent import AgentResponse, generate_response, select_tool
from .sse import format_sse
from .tools import TOOLS, run_tool


class ToolRequest(BaseModel):
    name: str
    args: Dict[str, Any] | None = None


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    tool: Optional[ToolRequest] = None
    client_id: Optional[str] = None


class ClientRegisterRequest(BaseModel):
    client_id: str = Field(min_length=1)
    tools: list[Dict[str, Any]]


class AgentRunRequest(BaseModel):
    threadId: Optional[str] = None
    runId: Optional[str] = None
    parentRunId: Optional[str] = None
    state: Dict[str, Any] = Field(default_factory=dict)
    messages: list[Dict[str, Any]] = Field(default_factory=list)
    tools: list[Dict[str, Any]] = Field(default_factory=list)
    context: list[Dict[str, Any]] = Field(default_factory=list)
    forwardedProps: Dict[str, Any] = Field(default_factory=dict)

    class Config:
        extra = "allow"


load_dotenv(override=True)

app = FastAPI(title="AG-UI + PydanticAI Demo")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
CLIENT_TOOLS: Dict[str, list[Dict[str, Any]]] = {}


@app.get("/api/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/api/tools")
def list_tools() -> Dict[str, Any]:
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


@app.get("/copilotkit/info")
@app.post("/copilotkit/info")
def copilotkit_info() -> Dict[str, Any]:
    return {
        "actions": {},
        "agents": {
            "default": {
                "name": "default",
                "description": "Default demo agent",
            }
        },
    }


@app.post("/copilotkit")
async def copilotkit_runtime_stub(request: Request) -> Dict[str, Any]:
    # Минимальная заглушка runtime, чтобы CopilotKit мог инициализироваться.
    payload: Dict[str, Any] = {}
    try:
        payload = await request.json()
    except Exception:
        payload = {}

    if payload.get("method") == "info":
        return copilotkit_info()

    return {"data": {}}


@app.post("/api/client/register")
def register_client(payload: ClientRegisterRequest) -> Dict[str, Any]:
    CLIENT_TOOLS[payload.client_id] = payload.tools
    return {"status": "ok", "tools_count": len(payload.tools)}


@app.post("/api/agent")
async def run_agent(payload: AgentRunRequest) -> StreamingResponse:
    thread_id = payload.threadId or str(uuid.uuid4())
    run_id = payload.runId or str(uuid.uuid4())

    tool_result_from_message: Optional[str] = None
    tool_call_id_from_message: Optional[str] = None
    for message in reversed(payload.messages):
        if message.get("role") == "tool":
            tool_result_from_message = str(message.get("content", ""))
            tool_call_id_from_message = message.get("toolCallId")
            break

    user_message = ""
    for message in reversed(payload.messages):
        if message.get("role") == "user":
            user_message = str(message.get("content", ""))
            break
    if not user_message:
        user_message = "Сформируй ответ для пользователя."

    cleaned_message, tool_name, tool_args, tool_error = _extract_server_tool(user_message)
    selection_source = "none"
    if tool_name:
        selection_source = "server_tool"
    tool_result: Optional[str] = tool_result_from_message
    frontend_tool = None
    if tool_result is None and not tool_name:
        backend_tools_payload = [
            {"name": tool.name, "description": tool.description, "input_schema": tool.input_schema}
            for tool in TOOLS
        ]
        model_choice = await select_tool(cleaned_message, payload.tools, backend_tools_payload)
        if model_choice:
            choice_type, choice_name, choice_args = model_choice
            if choice_type == "frontend":
                frontend_tool = (choice_name, choice_args)
            else:
                tool_name, tool_args = choice_name, choice_args
            selection_source = "model"
        else:
            auto_tool = _select_backend_tool(cleaned_message)
            if auto_tool:
                tool_name, tool_args = auto_tool
                selection_source = "heuristic"
    if tool_result is None and tool_name:
        try:
            tool_result = run_tool(tool_name, tool_args)
        except Exception as exc:
            tool_error = str(exc)

    if tool_result is None and not tool_name and frontend_tool is None:
        frontend_tool = _select_frontend_tool(payload.tools, cleaned_message)
        if frontend_tool:
            selection_source = "heuristic"

    response: Optional[AgentResponse]
    if frontend_tool:
        response = None
    elif tool_result_from_message is not None and not tool_name:
        response = AgentResponse(
            text=f"Результат инструмента: {tool_result}",
            used_mock=False,
            error=None,
        )
    else:
        response = await generate_response(cleaned_message, tool_result)
    assistant_message_id = str(uuid.uuid4())

    async def event_stream():
        input_payload: Dict[str, Any] = {
            "threadId": thread_id,
            "runId": run_id,
            "state": payload.state,
            "messages": payload.messages,
            "tools": payload.tools,
            "context": payload.context,
            "forwardedProps": payload.forwardedProps,
        }
        if payload.parentRunId:
            input_payload["parentRunId"] = payload.parentRunId

        run_started: Dict[str, Any] = {
            "type": "RUN_STARTED",
            "threadId": thread_id,
            "runId": run_id,
            "input": input_payload,
        }
        if payload.parentRunId:
            run_started["parentRunId"] = payload.parentRunId

        yield format_sse("message", run_started)

        if frontend_tool:
            tool_call_id = str(uuid.uuid4())
            tool_call_name, tool_call_args = frontend_tool
            yield format_sse(
                "message",
                {
                    "type": "TOOL_CALL_START",
                    "toolCallId": tool_call_id,
                    "toolCallName": tool_call_name,
                },
            )
            yield format_sse(
                "message",
                {
                    "type": "TOOL_CALL_ARGS",
                    "toolCallId": tool_call_id,
                    "delta": json.dumps(tool_call_args, ensure_ascii=False),
                },
            )
            yield format_sse(
                "message",
                {
                    "type": "TOOL_CALL_END",
                    "toolCallId": tool_call_id,
                },
            )
            yield format_sse(
                "message",
                {
                    "type": "RUN_FINISHED",
                    "threadId": thread_id,
                    "runId": run_id,
                    "result": {
                        "awaiting_tool": True,
                        "toolCallId": tool_call_id,
                        "toolCallName": tool_call_name,
                        "selection_source": selection_source,
                    },
                },
            )
            return

        yield format_sse(
            "message",
            {
                "type": "TEXT_MESSAGE_START",
                "messageId": assistant_message_id,
                "role": "assistant",
            },
        )

        for chunk in _chunk_text(response.text, chunk_size=72):
            yield format_sse(
                "message",
                {
                    "type": "TEXT_MESSAGE_CONTENT",
                    "messageId": assistant_message_id,
                    "delta": chunk,
                },
            )
            await asyncio.sleep(0)

        yield format_sse(
            "message",
            {
                "type": "TEXT_MESSAGE_END",
                "messageId": assistant_message_id,
            },
        )

        if tool_error:
            yield format_sse(
                "message",
                {
                    "type": "RUN_ERROR",
                    "message": tool_error,
                    "code": "tool_error",
                },
            )
            return

        if response.used_mock and response.error:
            yield format_sse(
                "message",
                {
                    "type": "CUSTOM",
                    "name": "MockFallback",
                    "value": {"error": response.error},
                },
            )

        yield format_sse(
            "message",
            {
                "type": "RUN_FINISHED",
                "threadId": thread_id,
                "runId": run_id,
                "result": {
                    "mock": response.used_mock,
                    "error": response.error,
                    "selection_source": selection_source,
                },
            },
        )

    return StreamingResponse(event_stream(), media_type="text/event-stream")


def _extract_server_tool(
    message: str,
) -> Tuple[str, Optional[str], Optional[Dict[str, Any]], Optional[str]]:
    tool_line: Optional[str] = None
    kept_lines = []
    for line in message.splitlines():
        if line.strip().startswith("[server_tool]"):
            tool_line = line.strip()
        else:
            kept_lines.append(line)
    cleaned = "\n".join(kept_lines).strip() or "Используй результат инструмента."

    if not tool_line:
        return cleaned, None, None, None

    try:
        after = tool_line.split("]", 1)[1].strip()
        if " args=" in after:
            name_part, args_part = after.split(" args=", 1)
        else:
            name_part, args_part = after, "{}"
        name = name_part.strip().split()[0]
        args = json.loads(args_part) if args_part.strip() else {}
        return cleaned, name, args, None
    except Exception as exc:
        return cleaned, None, None, str(exc)


def _select_frontend_tool(
    tools: list[Dict[str, Any]], message: str
) -> Optional[Tuple[str, Dict[str, Any]]]:
    tool_names = {tool.get("name") for tool in tools if isinstance(tool, dict)}
    if not tool_names:
        return None

    lowered = message.lower()
    if "увелич" in lowered or "increase" in lowered:
        if "adjustCounter" in tool_names:
            delta = _extract_first_number(lowered) or 1
            return ("adjustCounter", {"delta": abs(delta)})

    if "уменьш" in lowered or "сниз" in lowered or "убав" in lowered or "decrease" in lowered:
        if "adjustCounter" in tool_names:
            delta = _extract_first_number(lowered) or 1
            return ("adjustCounter", {"delta": -abs(delta)})

    return None


def _select_backend_tool(message: str) -> Optional[Tuple[str, Dict[str, Any]]]:
    lowered = message.lower()
    if "время" in lowered or "сколько времени" in lowered or "time" in lowered:
        return ("get_time", {})
    return None


def _extract_first_number(text: str) -> Optional[int]:
    import re

    match = re.search(r"-?\d+", text)
    if not match:
        return None
    try:
        return int(match.group(0))
    except ValueError:
        return None


@app.post("/api/chat/stream")
async def chat_stream(payload: ChatRequest) -> StreamingResponse:
    session_id = str(uuid.uuid4())

    async def event_stream():
        yield format_sse("session_started", {"session_id": session_id})
        if payload.client_id and payload.client_id in CLIENT_TOOLS:
            yield format_sse(
                "client_tools_known",
                {"tools": CLIENT_TOOLS[payload.client_id]},
            )

        tool_result: Optional[str] = None
        if payload.tool:
            yield format_sse(
                "tool_call",
                {"name": payload.tool.name, "args": payload.tool.args or {}},
            )
            try:
                tool_result = run_tool(payload.tool.name, payload.tool.args)
                yield format_sse(
                    "tool_result",
                    {"name": payload.tool.name, "result": tool_result},
                )
            except Exception as exc:
                yield format_sse("error", {"message": str(exc)})
                return

        response = await generate_response(payload.message, tool_result)
        if response.used_mock:
            yield format_sse(
                "warning",
                {"message": response.error or "Использован мок вместо OpenAI."},
            )

        for chunk in _chunk_text(response.text, chunk_size=48):
            yield format_sse("message_delta", {"delta": chunk})
            await asyncio.sleep(0.01)

        yield format_sse(
            "message_completed",
            {"message": response.text, "mock": response.used_mock},
        )

    return StreamingResponse(event_stream(), media_type="text/event-stream")


def _chunk_text(text: str, chunk_size: int) -> list[str]:
    return [text[i : i + chunk_size] for i in range(0, len(text), chunk_size)]

