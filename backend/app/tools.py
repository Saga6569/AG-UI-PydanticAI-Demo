from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    input_schema: Dict[str, Any]


TOOLS: List[Tool] = [
    Tool(
        name="get_time",
        description="Вернуть текущее время в UTC.",
        input_schema={"type": "object", "properties": {}, "additionalProperties": False},
    ),
]


def run_tool(name: str, args: Dict[str, Any] | None) -> str:
    args = args or {}
    if name == "get_time":
        return datetime.now(timezone.utc).isoformat()
    raise ValueError(f"Неизвестный инструмент: {name}")

