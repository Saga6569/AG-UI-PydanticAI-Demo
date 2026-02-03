from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List


@dataclass(frozen=True)
class Tool:
    # Описание backend-инструмента для фронта и выбора моделью.
    name: str
    description: str
    input_schema: Dict[str, Any]


def get_time() -> str:
    # Возвращаем текущее время UTC (ISO-8601).
    return datetime.now(timezone.utc).isoformat()


TOOLS: List[Tool] = [
    Tool(
        name="get_time",
        description="Вернуть текущее время в UTC.",
        input_schema={"type": "object", "properties": {}, "additionalProperties": False},
    ),
]



