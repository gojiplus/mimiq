"""Deterministic customer-support backend used by the browser examples."""

import re
import uuid
from dataclasses import dataclass
from typing import Any, Literal

from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="Mimiq Demo Customer Service Agent")

ORDERS = {
    "ORD-10031": {
        "order_id": "ORD-10031",
        "items": [{"name": "Hiking Backpack", "sku": "HB-220", "category": "outdoor_gear"}],
        "status": "delivered",
        "delivery_date": "2025-03-02",
    },
    "ORD-10027": {
        "order_id": "ORD-10027",
        "items": [
            {"name": "Wireless Earbuds Pro", "sku": "WE-500", "category": "personal_audio"}
        ],
        "status": "delivered",
        "delivery_date": "2025-02-18",
    },
    "ORD-20042": {
        "order_id": "ORD-20042",
        "items": [{"name": "Running Shoes", "sku": "RS-300", "category": "footwear"}],
        "status": "delivered",
        "delivery_date": "2025-03-14",
    },
}

NON_RETURNABLE_CATEGORIES = {"personal_audio", "perishables", "final_sale"}
ORDER_ID_PATTERN = re.compile(r"\bORD-\d+\b", re.IGNORECASE)


class ChatRequest(BaseModel):
    message: str
    sessionId: str | None = None


class ToolCallInfo(BaseModel):
    name: str
    args: dict[str, Any]
    result: Any = None


class ChatResponse(BaseModel):
    sessionId: str
    response: str
    toolCalls: list[ToolCallInfo] = Field(default_factory=list)
    terminalState: str | None = None


@dataclass
class Session:
    intent: Literal["return", "status"] | None = None


sessions: dict[str, Session] = {}


def find_order_id(message: str) -> str | None:
    match = ORDER_ID_PATTERN.search(message)
    return match.group(0).upper() if match else None


def infer_intent(message: str) -> Literal["return", "status"] | None:
    normalized = message.lower()
    if "return" in normalized:
        return "return"
    if any(word in normalized for word in ("status", "track", "delivery", "arrive")):
        return "status"
    return None


def terminal_response(
    session_id: str,
    response: str,
    tool_calls: list[ToolCallInfo],
    terminal_state: str,
) -> ChatResponse:
    return ChatResponse(
        sessionId=session_id,
        response=f"{response}\nTERMINAL_STATE: {terminal_state}",
        toolCalls=tool_calls,
        terminalState=terminal_state,
    )


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    session_id = request.sessionId or str(uuid.uuid4())
    session = sessions.setdefault(session_id, Session())
    session.intent = infer_intent(request.message) or session.intent
    order_id = find_order_id(request.message)

    if session.intent is None:
        return ChatResponse(
            sessionId=session_id,
            response="I can help with an order status or a return. Which do you need?",
        )

    if order_id is None:
        return ChatResponse(
            sessionId=session_id,
            response="Please share your order ID, for example ORD-10031.",
        )

    order = ORDERS.get(order_id)
    lookup = ToolCallInfo(name="lookup_order", args={"order_id": order_id}, result=order)
    if order is None:
        return ChatResponse(
            sessionId=session_id,
            response=f"I could not find order {order_id}. Please check the order ID.",
            toolCalls=[lookup],
        )

    if session.intent == "status":
        return terminal_response(
            session_id,
            f"Order {order_id} is {order['status']} and was delivered on {order['delivery_date']}.",
            [lookup],
            "order_info_provided",
        )

    item = order["items"][0]
    category = item["category"]
    returnable = category not in NON_RETURNABLE_CATEGORIES
    policy = ToolCallInfo(
        name="get_return_policy",
        args={"category": category},
        result={"category": category, "returnable": returnable},
    )
    if not returnable:
        return terminal_response(
            session_id,
            f"{item['name']} is not eligible for return under the {category} policy.",
            [lookup, policy],
            "return_denied_policy",
        )

    return_id = f"RET-{uuid.uuid4().hex[:6].upper()}"
    create = ToolCallInfo(
        name="create_return",
        args={"order_id": order_id, "item_sku": item["sku"], "reason": "customer request"},
        result={"return_id": return_id, "status": "created"},
    )
    return terminal_response(
        session_id,
        (
            f"I created return {return_id} for your {item['name']}. "
            "I will send the return label shortly."
        ),
        [lookup, policy, create],
        "return_created",
    )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


def main() -> None:
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8001)
