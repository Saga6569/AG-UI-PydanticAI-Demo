from __future__ import annotations

import json
from typing import Any, Dict


def format_sse(event: str, data: Dict[str, Any]) -> str:
    # Утилита для форматирования SSE-событий (сейчас не используется).
    payload = json.dumps(data, ensure_ascii=False)
    return f"event: {event}\ndata: {payload}\n\n"

