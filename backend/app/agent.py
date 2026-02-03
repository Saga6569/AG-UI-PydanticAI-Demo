from __future__ import annotations

import os
from functools import lru_cache

try:
    from pydantic_ai import Agent  # type: ignore
    from pydantic_ai.models.openai import OpenAIModel  # type: ignore
except Exception:  # pragma: no cover - fallback if dependency missing
    Agent = None  # type: ignore
    OpenAIModel = None  # type: ignore

from .tools import get_time


# Базовый системный промпт для демо-агента.
SYSTEM_PROMPT = (
    "Ты демонстрационный ассистент. Отвечай кратко и по делу. "
    "Если в контексте есть результат инструмента, используй его. "
    "Если пользователь спрашивает время, обязательно вызови get_time_tool."
)


def _build_model() -> "OpenAIModel":
    # Собираем OpenAI-совместимую модель (может быть Ollama через base_url).
    if OpenAIModel is None:
        raise RuntimeError("PydanticAI не установлен")
    model_name = os.getenv("OPENAI_MODEL", "llama3.1:8b")
    # OPENAI_BASE_URL читается клиентом openai из окружения.
    return OpenAIModel(model_name)


@lru_cache
def get_agent() -> "Agent":
    # Инициализируем и кешируем агента, чтобы не пересоздавать на каждый запрос.
    if Agent is None:
        raise RuntimeError("PydanticAI не установлен")
    agent = Agent(_build_model(), system_prompt=SYSTEM_PROMPT)

    @agent.tool
    def get_time_tool() -> str:
        # Backend-инструмент времени, доступен агенту.
        return get_time()

    return agent

