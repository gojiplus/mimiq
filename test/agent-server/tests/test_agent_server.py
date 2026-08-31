import asyncio
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from agent_server import ChatRequest, chat, sessions


class ChatTests(unittest.TestCase):
    def setUp(self) -> None:
        sessions.clear()

    def test_order_status_records_lookup_and_terminal_state(self) -> None:
        first = asyncio.run(chat(ChatRequest(message="I want to track my order")))
        response = asyncio.run(
            chat(ChatRequest(message="ORD-10031", sessionId=first.sessionId))
        )

        self.assertEqual(response.terminalState, "order_info_provided")
        self.assertEqual([call.name for call in response.toolCalls], ["lookup_order"])
        self.assertIn("TERMINAL_STATE: order_info_provided", response.response)

    def test_eligible_return_records_required_tools(self) -> None:
        first = asyncio.run(chat(ChatRequest(message="I need to return an item")))
        response = asyncio.run(
            chat(ChatRequest(message="ORD-10031", sessionId=first.sessionId))
        )

        self.assertEqual(response.terminalState, "return_created")
        self.assertEqual(
            [call.name for call in response.toolCalls],
            ["lookup_order", "get_return_policy", "create_return"],
        )

    def test_non_returnable_item_is_not_returned(self) -> None:
        first = asyncio.run(chat(ChatRequest(message="I need to return my earbuds")))
        response = asyncio.run(
            chat(ChatRequest(message="ORD-10027", sessionId=first.sessionId))
        )

        self.assertEqual(response.terminalState, "return_denied_policy")
        self.assertEqual(
            [call.name for call in response.toolCalls],
            ["lookup_order", "get_return_policy"],
        )
