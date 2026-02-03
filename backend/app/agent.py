from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional, Tuple, List, Dict, Any
import asyncio
import json

try:
    from pydantic_ai import Agent  # type: ignore
    from pydantic_ai.models.openai import OpenAIModel  # type: ignore
except Exception:  # pragma: no cover - fallback if dependency missing
    Agent = None  # type: ignore
    OpenAIModel = None  # type: ignore


SYSTEM_PROMPT = (
    "Ты демонстрационный ассистент. Отвечай кратко и по делу. "
    "Если в контексте есть результат инструмента, используй его."
)

TOOL_SELECTOR_PROMPT = (
    "Ты выбираешь инструмент для выполнения задачи пользователя. "
    "Верни только JSON без пояснений."
)


@dataclass
class AgentResponse:
    text: str
    used_mock: bool
    error: Optional[str] = None


def _build_prompt(user_message: str, tool_result: Optional[str]) -> str:
    if tool_result:
        return (
            f"Результат инструмента: {tool_result}\n\n"
            f"Сообщение пользователя: {user_message}"
        )
    return user_message


async def _run_pydantic_ai(prompt: str, system_prompt: Optional[str] = None) -> str:
    if Agent is None or OpenAIModel is None:
        raise RuntimeError("PydanticAI не установлен")
    model_name = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    base_url = os.getenv("OPENAI_BASE_URL")
    try:
        model = OpenAIModel(model_name, base_url=base_url)
    except TypeError:
        model = OpenAIModel(model_name)
    agent = Agent(model, system_prompt=system_prompt or SYSTEM_PROMPT)
    result = await agent.run(prompt)
    if hasattr(result, "data"):
        return str(result.data)
    return str(result)


def _mock_response(user_message: str, tool_result: Optional[str]) -> str:
    if tool_result:
        return (
            "MOCK: Использую результат инструмента. "
            f"Вот что я получил: {tool_result}. "
            f"Пользователь спросил: {user_message}"
        )
    return f"MOCK: Ответ на сообщение пользователя: {user_message}"


async def generate_response(user_message: str, tool_result: Optional[str]) -> AgentResponse:
    api_key = os.getenv("OPENAI_API_KEY")
    prompt = _build_prompt(user_message, tool_result)
    if not api_key:
        return AgentResponse(text=_mock_response(user_message, tool_result), used_mock=True)

    try:
        timeout_seconds = float(os.getenv("OPENAI_TIMEOUT_SECONDS", "45"))
        text = await asyncio.wait_for(_run_pydantic_ai(prompt), timeout=timeout_seconds)
        return AgentResponse(text=text, used_mock=False)
    except asyncio.TimeoutError:
        return AgentResponse(
            text="Ошибка: истекло время ожидания ответа модели.",
            used_mock=False,
            error="timeout",
        )
    except Exception as exc:
        return AgentResponse(
            text=_mock_response(user_message, tool_result),
            used_mock=True,
            error=str(exc),
        )


def _extract_json_object(text: str) -> str:
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("JSON object not found")
    return text[start : end + 1]


async def select_tool(
    user_message: str,
    frontend_tools: List[Dict[str, Any]],
    backend_tools: List[Dict[str, Any]],
) -> Optional[Tuple[str, str, Dict[str, Any]]]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None

    prompt = (
        "Доступные инструменты:\n"
        f"frontend: {json.dumps(frontend_tools, ensure_ascii=False)}\n"
        f"backend: {json.dumps(backend_tools, ensure_ascii=False)}\n\n"
        "Сообщение пользователя:\n"
        f"{user_message}\n\n"
        'Верни JSON строго в формате: {"type":"frontend|backend|null","name":string|null,"args":object}\n'
        'Если инструмент не нужен, верни {"type":"null","name":null,"args":{}}'
    )

    try:
        raw = await _run_pydantic_ai(prompt, system_prompt=TOOL_SELECTOR_PROMPT)
        data = json.loads(_extract_json_object(raw))
    except Exception:
        return None

    tool_type = str(data.get("type") or "null")
    name = data.get("name")
    args = data.get("args") if isinstance(data.get("args"), dict) else {}

    if tool_type not in {"frontend", "backend"}:
        return None
    if not isinstance(name, str) or not name:
        return None

    return (tool_type, name, args)

