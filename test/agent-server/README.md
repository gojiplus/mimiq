# Demo Agent Server

This deterministic customer-service backend makes the browser examples runnable without a cloud API key. It returns tool calls and terminal states so the adapter and evaluator have a stable target. It is not an example of a production agent.

## Setup

```bash
cd test/agent-server
uv sync
```

## Running

```bash
uv run uvicorn agent_server:app --app-dir src --port 8001
```

Or use the script entry point:

```bash
uv run demo-agent
```

## API

### POST /chat

Send a message and get an agent response.

**Request:**
```json
{
  "message": "I want to return my order",
  "sessionId": "optional-session-id"
}
```

**Response:**
```json
{
  "sessionId": "session-uuid",
  "response": "I'd be happy to help with your return...",
  "toolCalls": [
    {"name": "lookup_order", "args": {"order_id": "ORD-10031"}, "result": {...}}
  ],
  "terminalState": "return_created"
}
```

## Mock Data

The demo uses mock order data:

- `ORD-10031`: Hiking Backpack (returnable, outdoor_gear category)
- `ORD-10027`: Wireless Earbuds Pro (non-returnable, personal_audio category)

## Tools Available

- `lookup_order(order_id)` - Get order details
- `lookup_customer_orders(email)` - Get all orders for a customer
- `get_return_policy(category)` - Check if category is returnable
- `create_return(order_id, item_sku, reason)` - Create a return
- `escalate_to_human(reason)` - Escalate to human agent

## Terminal States

The agent emits `TERMINAL_STATE: <state>` when conversation reaches a resolution:

- `return_created` - Return was successfully created
- `return_denied_policy` - Return denied due to policy
- `escalated_to_human` - Conversation handed to human agent
- `order_info_provided` - Customer just wanted order status
