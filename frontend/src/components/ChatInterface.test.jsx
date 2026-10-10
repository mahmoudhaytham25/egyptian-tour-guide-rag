import { act, fireEvent, render, screen } from "@testing-library/react";
import ChatInterface from "./ChatInterface";
import api from "../services/api";

vi.mock("../services/api", () => ({
  default: {
    getUserId: vi.fn(),
    getConversations: vi.fn(),
    getConversation: vi.fn(),
    createConversation: vi.fn(),
    addMessageToConversation: vi.fn(),
    deleteConversation: vi.fn(),
    askQuestion: vi.fn(),
    logout: vi.fn(),
    isAuthenticated: vi.fn(),
    getAuthToken: vi.fn(),
    setAuthToken: vi.fn(),
  },
}));

const USER_ID = "user-1";

const CONVERSATIONS = [
  { _id: "c1", title: "First chat", updatedAt: "2026-01-01T10:00:00Z" },
  { _id: "c2", title: "Second chat", updatedAt: "2026-01-02T10:00:00Z" },
];

const C1_MESSAGES = {
  conversation: { _id: "c1" },
  messages: [
    {
      _id: "m1",
      role: "user",
      content: "First question",
      timestamp: "2026-01-01T10:00:00Z",
    },
    {
      _id: "m2",
      role: "assistant",
      content: "First answer",
      timestamp: "2026-01-01T10:00:01Z",
    },
  ],
};

const C2_MESSAGES = {
  conversation: { _id: "c2" },
  messages: [
    {
      _id: "m3",
      role: "user",
      content: "Second convo question",
      timestamp: "2026-01-02T10:00:00Z",
    },
  ],
};

// Flush the promise chains inside the component's async handlers without
// touching (fake) timers — needed between a UI action and its awaited result.
const flushPromises = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });

const typeQuestion = (text) => {
  fireEvent.change(screen.getByPlaceholderText("Type your message..."), {
    target: { value: text },
  });
};

const clickSend = () => {
  fireEvent.click(document.querySelector(".send-button"));
};

const sendViaEnter = (text) => {
  const textarea = screen.getByPlaceholderText("Type your message...");
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.keyDown(textarea, { key: "Enter" });
};

describe("ChatInterface", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    api.getUserId.mockReturnValue(USER_ID);
    api.getConversations.mockResolvedValue([]);
    api.getConversation.mockResolvedValue({ messages: [] });
    api.createConversation.mockResolvedValue({ _id: "conv-new" });
    api.askQuestion.mockResolvedValue({ answer: "ok" });
    // jsdom doesn't implement scrollIntoView.
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("fetches the sidebar list and opens the most recent conversation", async () => {
    api.getConversations.mockResolvedValue(CONVERSATIONS);
    api.getConversation.mockImplementation(async (id) =>
      id === "c1" ? C1_MESSAGES : C2_MESSAGES
    );

    render(<ChatInterface />);

    expect(await screen.findByText("First chat")).toBeInTheDocument();
    expect(screen.getByText("Second chat")).toBeInTheDocument();
    expect(await screen.findByText("First question")).toBeInTheDocument();
    expect(screen.getByText("First answer")).toBeInTheDocument();
    expect(api.getConversation).toHaveBeenCalledWith("c1");
    // The most recent conversation is marked active and remembered.
    const active = document.querySelector(".conversation-item.active");
    expect(active).toHaveTextContent("First chat");
    expect(localStorage.getItem(`conversationId_${USER_ID}`)).toBe("c1");
  });

  it("shows the empty sidebar hint when there are no conversations", async () => {
    render(<ChatInterface />);
    expect(await screen.findByText("No conversations yet.")).toBeInTheDocument();
  });

  it("skips history loading entirely when there is no user id", async () => {
    api.getUserId.mockReturnValue(null);
    render(<ChatInterface />);
    await flushPromises();
    expect(api.getConversations).not.toHaveBeenCalled();
  });

  it("sends a question, lazily creates a conversation, and streams the reply", async () => {
    const answer =
      "Answer42: The Nile shaped Egyptian civilization in profound ways.";
    api.askQuestion.mockResolvedValue({ answer });
    render(<ChatInterface />);
    await screen.findByText("No conversations yet.");

    vi.useFakeTimers();

    typeQuestion("Tell me about the nile");
    clickSend();
    await flushPromises();

    // A conversation is created lazily so /query can persist into it.
    expect(api.createConversation).toHaveBeenCalledWith({
      title: "Tell me about the nile",
    });
    expect(api.askQuestion).toHaveBeenCalledWith({
      query: "Tell me about the nile",
      conversationId: "conv-new",
    });
    expect(localStorage.getItem(`conversationId_${USER_ID}`)).toBe("conv-new");
    expect(screen.getByText("Tell me about the nile")).toBeInTheDocument();

    // Streaming is progressive: the first chunk is visible, the full
    // answer is not committed until the chunk timers run out.
    expect(screen.getByText(answer.slice(0, 4))).toBeInTheDocument();
    expect(screen.queryByText(answer)).not.toBeInTheDocument();

    await act(async () => {
      vi.runAllTimers();
    });

    expect(screen.getByText(answer)).toBeInTheDocument();
    // Follow-up suggestions arrive on the delayed timer too.
    expect(
      screen.getByText("You might also want to ask:")
    ).toBeInTheDocument();
  });

  it("ignores further sends while a reply is in flight", async () => {
    api.askQuestion.mockResolvedValue({
      answer: "A".repeat(200) + " end",
    });
    render(<ChatInterface />);
    await screen.findByText("No conversations yet.");

    vi.useFakeTimers();

    typeQuestion("First question");
    clickSend();
    await flushPromises();
    expect(api.askQuestion).toHaveBeenCalledTimes(1);

    // The input still accepts text, but Enter and the button are guarded.
    sendViaEnter("Second question");
    clickSend();
    await flushPromises();

    expect(api.askQuestion).toHaveBeenCalledTimes(1);
    // The guarded send was swallowed — the typed text stays in the input
    // and the send button reflects the in-flight state.
    expect(screen.getByPlaceholderText("Type your message...")).toHaveValue(
      "Second question"
    );
    expect(document.querySelector(".send-button")).toBeDisabled();
  });

  it("guides instead of querying on a vague first question", async () => {
    render(<ChatInterface />);
    await screen.findByText("No conversations yet.");

    sendViaEnter("tell me more");
    await flushPromises();

    expect(api.askQuestion).not.toHaveBeenCalled();
    expect(
      screen.getByText(/please be more specific/i)
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Type your message...")
    ).toHaveValue("");
  });

  it("sends a follow-up suggestion when its button is clicked", async () => {
    api.askQuestion.mockResolvedValue({
      answer: "Pyramids were royal tombs built over decades.",
    });
    render(<ChatInterface />);
    await screen.findByText("No conversations yet.");

    vi.useFakeTimers();

    typeQuestion("Tell me about pyramids");
    clickSend();
    await flushPromises();
    await act(async () => {
      vi.runAllTimers();
    });

    const suggestion = document.querySelector(".suggestion-button");
    expect(suggestion).not.toBeNull();
    const suggestionText = suggestion.textContent;
    fireEvent.click(suggestion);
    await flushPromises();

    expect(api.askQuestion).toHaveBeenLastCalledWith({
      query: suggestionText,
      conversationId: "conv-new",
    });
    expect(api.askQuestion).toHaveBeenCalledTimes(2);
  });

  it("switches conversations and drops a pending stream", async () => {
    const longAnswer = "A".repeat(300);
    api.askQuestion.mockResolvedValue({ answer: longAnswer });
    api.getConversations.mockResolvedValue(CONVERSATIONS);
    api.getConversation.mockImplementation(async (id) =>
      id === "c1" ? C1_MESSAGES : C2_MESSAGES
    );

    render(<ChatInterface />);
    await screen.findByText("First question");

    vi.useFakeTimers();

    typeQuestion("stream me a long answer");
    clickSend();
    await flushPromises();

    // Streaming has started — first chunk visible — when we switch away.
    expect(screen.getByText(longAnswer.slice(0, 4))).toBeInTheDocument();
    fireEvent.click(screen.getByText("Second chat"));
    await flushPromises();

    // The other conversation's history replaced the pane.
    expect(screen.getByText("Second convo question")).toBeInTheDocument();
    expect(screen.queryByText("First question")).not.toBeInTheDocument();

    // Any leftover stream timer would leak the reply into this pane.
    await act(async () => {
      vi.runAllTimers();
    });
    expect(screen.queryByText(longAnswer)).not.toBeInTheDocument();
    expect(
      document.querySelector(".conversation-item.active")
    ).toHaveTextContent("Second chat");
  });

  it("loads a conversation's messages when its sidebar item is clicked", async () => {
    api.getConversations.mockResolvedValue(CONVERSATIONS);
    api.getConversation.mockImplementation(async (id) =>
      id === "c1" ? C1_MESSAGES : C2_MESSAGES
    );

    render(<ChatInterface />);
    await screen.findByText("First question");
    api.getConversation.mockClear();

    fireEvent.click(screen.getByText("Second chat"));

    expect(await screen.findByText("Second convo question")).toBeInTheDocument();
    expect(screen.queryByText("First question")).not.toBeInTheDocument();
    expect(api.getConversation).toHaveBeenCalledWith("c2");
    expect(localStorage.getItem(`conversationId_${USER_ID}`)).toBe("c2");
    expect(
      document.querySelector(".conversation-item.active")
    ).toHaveTextContent("Second chat");

    // Clicking the already-active conversation doesn't refetch.
    api.getConversation.mockClear();
    fireEvent.click(screen.getByText("Second chat"));
    expect(api.getConversation).not.toHaveBeenCalled();
  });

  it("clears the pane and stored id on '+ New chat'", async () => {
    api.getConversations.mockResolvedValue(CONVERSATIONS);
    api.getConversation.mockImplementation(async (id) =>
      id === "c1" ? C1_MESSAGES : C2_MESSAGES
    );

    render(<ChatInterface />);
    await screen.findByText("First question");
    expect(localStorage.getItem(`conversationId_${USER_ID}`)).toBe("c1");

    fireEvent.click(screen.getByRole("button", { name: "+ New chat" }));

    expect(screen.queryByText("First question")).not.toBeInTheDocument();
    expect(localStorage.getItem(`conversationId_${USER_ID}`)).toBeNull();
    expect(
      document.querySelector(".conversation-item.active")
    ).toBeNull();
  });

  it("deletes a conversation after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    api.deleteConversation.mockResolvedValue({ message: "deleted" });
    api.getConversations.mockResolvedValue(CONVERSATIONS);
    api.getConversation.mockImplementation(async (id) =>
      id === "c1" ? C1_MESSAGES : C2_MESSAGES
    );

    render(<ChatInterface />);
    await screen.findByText("First question");

    const deleteButtons = screen.getAllByRole("button", {
      name: "Delete conversation",
    });
    // Delete the inactive one first — the open pane is untouched.
    fireEvent.click(deleteButtons[1]);
    await flushPromises();

    expect(api.deleteConversation).toHaveBeenCalledWith("c2");
    expect(screen.queryByText("Second chat")).not.toBeInTheDocument();
    expect(screen.getByText("First question")).toBeInTheDocument();

    // Deleting the active conversation resets the pane.
    fireEvent.click(
      screen.getByRole("button", { name: "Delete conversation" })
    );
    await flushPromises();
    expect(api.deleteConversation).toHaveBeenCalledWith("c1");
    expect(screen.queryByText("First question")).not.toBeInTheDocument();
    expect(screen.getByText("No conversations yet.")).toBeInTheDocument();
  });

  it("keeps the conversation when the delete is cancelled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    api.getConversations.mockResolvedValue(CONVERSATIONS);
    api.getConversation.mockImplementation(async (id) =>
      id === "c1" ? C1_MESSAGES : C2_MESSAGES
    );

    render(<ChatInterface />);
    await screen.findByText("First question");

    fireEvent.click(
      screen.getAllByRole("button", { name: "Delete conversation" })[1]
    );
    await flushPromises();

    expect(api.deleteConversation).not.toHaveBeenCalled();
    expect(screen.getByText("Second chat")).toBeInTheDocument();
  });

  it("surfaces the server error message when the query fails", async () => {
    api.askQuestion.mockRejectedValue({
      response: { data: { message: "Model is down" } },
    });
    render(<ChatInterface />);
    await screen.findByText("No conversations yet.");

    typeQuestion("Will this fail?");
    clickSend();

    expect(await screen.findByText("Model is down")).toBeInTheDocument();
    // Loading state is cleared — typing enables the send button again.
    typeQuestion("try again");
    expect(document.querySelector(".send-button")).not.toBeDisabled();
  });

  it("retries once as a plain query when the backend 400s the conversation payload", async () => {
    api.askQuestion
      .mockRejectedValueOnce({ response: { status: 400 } })
      .mockResolvedValueOnce({ answer: "ok" });
    render(<ChatInterface />);
    await screen.findByText("No conversations yet.");

    typeQuestion("Trigger the retry");
    clickSend();
    await flushPromises();

    expect(api.askQuestion).toHaveBeenNthCalledWith(1, {
      query: "Trigger the retry",
      conversationId: "conv-new",
    });
    // Second attempt drops the conversation payload entirely.
    expect(api.askQuestion).toHaveBeenNthCalledWith(2, {
      query: "Trigger the retry",
    });
    expect(api.askQuestion).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("ok")).toBeInTheDocument();
  });

  it("falls back to plain /query when the conversation API is missing", async () => {
    api.getConversations.mockRejectedValue({ response: { status: 404 } });
    render(<ChatInterface />);
    await screen.findByText("No conversations yet.");

    // "What is this?" would trip the vague-question guard — ask a real one.
    typeQuestion("Who built the pyramids?");
    clickSend();
    await flushPromises();

    expect(api.createConversation).not.toHaveBeenCalled();
    expect(api.askQuestion).toHaveBeenCalledWith({
      query: "Who built the pyramids?",
    });
  });

  it("clears the chat when the auth token is removed in another tab", async () => {
    api.getConversations.mockResolvedValue(CONVERSATIONS);
    api.getConversation.mockImplementation(async (id) =>
      id === "c1" ? C1_MESSAGES : C2_MESSAGES
    );

    render(<ChatInterface />);
    await screen.findByText("First question");

    const evt = new Event("storage");
    evt.key = "authToken";
    evt.newValue = null;
    act(() => {
      window.dispatchEvent(evt);
    });

    expect(screen.queryByText("First question")).not.toBeInTheDocument();
    expect(screen.getByText("No conversations yet.")).toBeInTheDocument();
    expect(
      document.querySelector(".conversation-item.active")
    ).toBeNull();
  });

  it("calls api.logout from the header logout button", async () => {
    render(<ChatInterface />);
    await screen.findByText("No conversations yet.");

    // jsdom reports the resulting navigation as "not implemented" — that's
    // expected noise; what matters is the session teardown.
    fireEvent.click(screen.getByRole("button", { name: "Logout" }));
    expect(api.logout).toHaveBeenCalled();
  });
});
