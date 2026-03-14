import { useState, useRef, useEffect, FormEvent } from "react";
import { sendMessage, ChatResponse, ToolCall } from "./api";

interface Message {
  role: "user" | "assistant";
  text: string;
  toolCalls?: ToolCall[];
}

const styles = {
  container: {
    maxWidth: "800px",
    margin: "0 auto",
    padding: "20px",
    fontFamily: "system-ui, -apple-system, sans-serif",
  } as const,
  header: {
    textAlign: "center" as const,
    marginBottom: "20px",
  },
  transcript: {
    border: "1px solid #ddd",
    borderRadius: "8px",
    padding: "20px",
    minHeight: "400px",
    maxHeight: "500px",
    overflowY: "auto" as const,
    backgroundColor: "#fafafa",
    marginBottom: "20px",
  },
  messageRow: {
    marginBottom: "16px",
    padding: "12px",
    borderRadius: "8px",
  },
  userMessage: {
    backgroundColor: "#e3f2fd",
    marginLeft: "40px",
  },
  assistantMessage: {
    backgroundColor: "#fff",
    marginRight: "40px",
    border: "1px solid #eee",
  },
  roleLabel: {
    fontSize: "12px",
    fontWeight: "bold" as const,
    color: "#666",
    marginBottom: "4px",
  },
  messageText: {
    lineHeight: "1.5",
    whiteSpace: "pre-wrap" as const,
  },
  inputForm: {
    display: "flex",
    gap: "10px",
  },
  input: {
    flex: 1,
    padding: "12px",
    fontSize: "16px",
    border: "1px solid #ddd",
    borderRadius: "8px",
  },
  sendButton: {
    padding: "12px 24px",
    fontSize: "16px",
    backgroundColor: "#1976d2",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
  },
  actionButtons: {
    display: "flex",
    gap: "10px",
    marginBottom: "20px",
  },
  actionButton: {
    padding: "8px 16px",
    fontSize: "14px",
    backgroundColor: "#fff",
    border: "1px solid #ddd",
    borderRadius: "4px",
    cursor: "pointer",
  },
  statusBar: {
    padding: "8px",
    textAlign: "center" as const,
    fontSize: "12px",
    color: "#666",
  },
};

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: userMessage }]);
    setIsLoading(true);

    try {
      const response: ChatResponse = await sendMessage(userMessage, sessionId);
      setSessionId(response.sessionId);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: response.response, toolCalls: response.toolCalls },
      ]);
    } catch (error) {
      console.error("Error:", error);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickAction = async (action: string) => {
    if (isLoading) return;

    let message = "";
    if (action === "track-order") {
      message = "I'd like to track my order.";
    } else if (action === "start-return") {
      message = "I'd like to return an item please.";
    }

    setMessages((prev) => [...prev, { role: "user", text: message }]);
    setIsLoading(true);

    try {
      const response: ChatResponse = await sendMessage(message, sessionId);
      setSessionId(response.sessionId);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: response.response, toolCalls: response.toolCalls },
      ]);
    } catch (error) {
      console.error("Error:", error);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const allToolCalls = messages.flatMap((m) => m.toolCalls ?? []);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1>TechShop Support</h1>
        <p>How can we help you today?</p>
      </div>

      <div style={styles.actionButtons}>
        <button
          data-test="track-order"
          style={styles.actionButton}
          onClick={() => handleQuickAction("track-order")}
          disabled={isLoading}
        >
          Track Order
        </button>
        <button
          data-test="start-return"
          style={styles.actionButton}
          onClick={() => handleQuickAction("start-return")}
          disabled={isLoading}
        >
          Start Return
        </button>
      </div>

      <div data-test="transcript" style={styles.transcript} ref={transcriptRef}>
        {messages.map((msg, idx) => (
          <div
            key={idx}
            data-test="message-row"
            data-role={msg.role}
            style={{
              ...styles.messageRow,
              ...(msg.role === "user"
                ? styles.userMessage
                : styles.assistantMessage),
            }}
          >
            <div style={styles.roleLabel}>
              {msg.role === "user" ? "You" : "Support Agent"}
            </div>
            <div data-test="message-text" style={styles.messageText}>
              {msg.text}
            </div>
          </div>
        ))}
        {isLoading && (
          <div
            data-test="message-row"
            data-role="assistant"
            style={{ ...styles.messageRow, ...styles.assistantMessage }}
          >
            <div style={styles.roleLabel}>Support Agent</div>
            <div data-test="message-text" style={styles.messageText}>
              Thinking...
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} style={styles.inputForm}>
        <input
          data-test="chat-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your message..."
          style={styles.input}
          disabled={isLoading}
        />
        <button
          data-test="send-button"
          type="submit"
          style={{
            ...styles.sendButton,
            opacity: isLoading ? 0.7 : 1,
          }}
          disabled={isLoading}
        >
          Send
        </button>
      </form>

      <div style={styles.statusBar}>
        {isLoading ? (
          <span data-test="agent-working">Agent is working...</span>
        ) : (
          <span data-test="agent-idle">Agent is ready</span>
        )}
      </div>
      <script
        data-test="tool-calls"
        type="application/json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(allToolCalls) }}
      />
    </div>
  );
}
