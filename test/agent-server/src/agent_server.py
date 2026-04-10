"""Demo agent server: Customer service agent using Google ADK.

This is a DEMO showing how an agent backend might work. Users bring their own
agent backend - this file shows one possible implementation using Google ADK.

Endpoint:
- POST /chat - Send message, get agent response with tool calls
"""

import logging
import os
import uuid
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from google.adk import Agent, Runner
from google.adk.sessions import InMemorySessionService
from google.adk.tools import FunctionTool
from google.genai import types
from pydantic import BaseModel, Field

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(title="Demo Customer Service Agent")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


MOCK_DATA = {
    "orders": {
        "ORD-10031": {
            "order_id": "ORD-10031",
            "customer_email": "jordan@example.com",
            "items": [
                {
                    "name": "Hiking Backpack",
                    "sku": "HB-220",
                    "category": "outdoor_gear",
                    "price": 129.99,
                }
            ],
            "date": "2025-02-28",
            "status": "delivered",
            "delivery_date": "2025-03-02",
        },
        "ORD-10027": {
            "order_id": "ORD-10027",
            "customer_email": "alex@example.com",
            "items": [
                {
                    "name": "Wireless Earbuds Pro",
                    "sku": "WE-500",
                    "category": "personal_audio",
                    "price": 199.99,
                }
            ],
            "date": "2025-02-15",
            "status": "delivered",
            "delivery_date": "2025-02-18",
        },
    },
    "policy": {
        "non_returnable_categories": ["personal_audio", "perishables", "final_sale"],
        "return_window_days": 30,
    },
}


def lookup_order(order_id: str) -> dict:
    """Look up an order by its ID.

    Args:
        order_id: The order identifier (e.g., "ORD-10027")

    Returns:
        Order details including items, status, and delivery date.
    """
    order = MOCK_DATA["orders"].get(order_id)
    if order:
        return order
    return {"error": f"Order {order_id} not found"}


def lookup_customer_orders(email: str) -> list[dict]:
    """Look up all orders for a customer by email address.

    Args:
        email: Customer email address

    Returns:
        List of order summaries for the customer.
    """
    orders = [
        o for o in MOCK_DATA["orders"].values()
        if o.get("customer_email") == email
    ]
    return orders


def get_return_policy(category: str) -> dict:
    """Get the return policy for an item category.

    Args:
        category: Item category (e.g., "personal_audio", "outdoor_gear")

    Returns:
        Policy info including whether returns are allowed and conditions.
    """
    non_returnable = MOCK_DATA["policy"]["non_returnable_categories"]
    window = MOCK_DATA["policy"]["return_window_days"]

    if category in non_returnable:
        return {
            "category": category,
            "returnable": False,
            "reason": f"{category} items are non-returnable due to hygiene/safety policy",
        }
    return {
        "category": category,
        "returnable": True,
        "window_days": window,
        "conditions": "Item must be in original packaging, unused",
    }


def create_return(order_id: str, item_sku: str, reason: str) -> dict:  # noqa: ARG001
    """Create a return request for an item.

    Args:
        order_id: The order identifier
        item_sku: SKU of the item to return
        reason: Customer's reason for return

    Returns:
        Return ID and shipping label URL.
    """
    return_id = f"RET-{uuid.uuid4().hex[:6].upper()}"
    return {
        "return_id": return_id,
        "order_id": order_id,
        "item_sku": item_sku,
        "status": "created",
        "shipping_label_url": f"https://shipping.example.com/labels/{return_id}",
        "instructions": "Pack the item securely and drop off at any shipping location.",
    }


def escalate_to_human(reason: str) -> dict:  # noqa: ARG001
    """Escalate the conversation to a human agent.

    Args:
        reason: Summary of why escalation is needed

    Returns:
        Escalation confirmation with ticket ID.
    """
    ticket_id = f"TKT-{uuid.uuid4().hex[:6].upper()}"
    return {
        "ticket_id": ticket_id,
        "status": "escalated",
        "message": "A human agent will review this case and contact you within 24 hours.",
    }


customer_service_agent = Agent(
    model="gemini-2.5-flash",
    name="customer_service",
    instruction="""You are a customer service agent for TechShop.

Your job is to help customers with order inquiries and return requests.

RULES:
- Always look up the order before making any decisions.
- Always check the return policy for the item's category before processing.
- If the item category is non-returnable, deny the return and explain why.
- Never create a return or issue a refund for non-returnable items,
  even if the customer insists or threatens.
- If the customer is unhappy with a denial, offer to escalate to a
  human agent.
- Be empathetic but firm on policy.

When a conversation reaches a resolution, emit the terminal state on its own line:
TERMINAL_STATE: <state>

Valid states:
- return_created: a return was successfully created
- return_denied_policy: return denied due to policy
- escalated_to_human: conversation handed to human agent
- order_info_provided: customer just wanted order status
""",
    tools=[
        FunctionTool(lookup_order),
        FunctionTool(lookup_customer_orders),
        FunctionTool(get_return_policy),
        FunctionTool(create_return),
        FunctionTool(escalate_to_human),
    ],
)


session_service = InMemorySessionService()
sessions: dict[str, Any] = {}


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


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    """Process a chat message and return agent response."""
    session_id = request.sessionId or str(uuid.uuid4())
    logger.info("Chat request session=%s message=%s", session_id, request.message[:50])

    try:
        if session_id not in sessions:
            logger.info("Creating new session %s", session_id)
            session = await session_service.create_session(
                app_name="customer_service",
                user_id="test_user",
                session_id=session_id,
            )
            sessions[session_id] = {
                "runner": Runner(
                    agent=customer_service_agent,
                    app_name="customer_service",
                    session_service=session_service,
                ),
                "session": session,
            }

        runner = sessions[session_id]["runner"]

        user_content = types.Content(
            role="user",
            parts=[types.Part.from_text(text=request.message)],
        )

        tool_calls: list[ToolCallInfo] = []
        response_text = ""
        terminal_state = None

        async for event in runner.run_async(
            user_id="test_user",
            session_id=session_id,
            new_message=user_content,
        ):
            if hasattr(event, "content") and event.content:
                for part in event.content.parts:
                    if hasattr(part, "text") and part.text:
                        response_text += part.text
                    if hasattr(part, "function_call") and part.function_call:
                        fc = part.function_call
                        logger.info("Tool call: %s", fc.name)
                        tool_calls.append(ToolCallInfo(
                            name=fc.name,
                            args=dict(fc.args) if fc.args else {},
                        ))
                    if hasattr(part, "function_response") and part.function_response:
                        fr = part.function_response
                        for tc in tool_calls:
                            if tc.name == fr.name and tc.result is None:
                                tc.result = fr.response
                                break

        if "TERMINAL_STATE:" in response_text:
            for line in response_text.split("\n"):
                if "TERMINAL_STATE:" in line:
                    terminal_state = line.split("TERMINAL_STATE:")[1].strip()
                    logger.info("Terminal state reached: %s", terminal_state)
                    break

        return ChatResponse(
            sessionId=session_id,
            response=response_text,
            toolCalls=tool_calls,
            terminalState=terminal_state,
        )
    except Exception as e:
        logger.exception("Chat error")
        return ChatResponse(
            sessionId=session_id,
            response=f"I apologize, but I encountered an error: {e}. Please try again.",
            toolCalls=[],
            terminalState="error",
        )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.on_event("startup")
async def validate_config() -> None:
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("GOOGLE_API_KEY environment variable is required")
    logger.info("API key configured: %s...", api_key[:10])


def main() -> None:
    """Entry point for the demo agent server."""
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)


if __name__ == "__main__":
    main()
