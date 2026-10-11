import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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
    getDocuments: vi.fn(),
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

const DOCUMENTS = [
  {
    id: "egyptian_history",
    filename: "egyptian_history.pdf",
    originalName: "egyptian_history.pdf",
    indexed: true,
  },
  {
    id: "alexandria_guide",
    filename: "alexandria_guide.pdf",
    originalName: "Alexandria Guide.pdf",
    indexed: true,
  },
  {
    id: "fresh_upload",
    filename: "fresh_upload.pdf",
    originalName: "fresh_upload.pdf",
    indexed: false,
  },
];

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

// The header renders a react-router <Link>, so every render needs a Router.
const renderChat = () =>
  render(
    <MemoryRouter>
      <ChatInterface />
    </MemoryRouter>
  );

describe("ChatInterface", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    api.getUserId.mockReturnValue(USER_ID);
    api.getConversations.mockResolvedValue([]);
    api.getConversation.mockResolvedValue({ messages: [] });
    api.createConversation.mockResolvedValue({ _id: "conv-new" });
    api.askQuestion.mockResolvedValue({ answer: "ok" });
    api.getDocuments.mockResolvedValue({ documents: DOCUMENTS });
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

    renderChat();

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
    renderChat();
    expect(await screen.findByText("No conversations yet.")).toBeInTheDocument();
  });

  it("skips history loading entirely when there is no user id", async () => {
    api.getUserId.mockReturnValue(null);
    renderChat();
    await flushPromises();
    expect(api.getConversations).not.toHaveBeenCalled();
  });

  it("sends a question, lazily creates a conversation, and streams the reply", async () => {
    const answer =
      "Answer42: The Nile shaped Egyptian civilization in profound ways.";
    api.askQuestion.mockResolvedValue({ answer });
    renderChat();
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
      document: "egyptian_history",
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
    renderChat();
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
    renderChat();
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
    renderChat();
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
      document: "egyptian_history",
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

    renderChat();
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

  it("drops a /query reply that resolves after switching conversations", async () => {
    let resolveAsk;
    api.askQuestion.mockReturnValue(
      new Promise((resolve) => {
        resolveAsk = resolve;
      })
    );
    api.getConversations.mockResolvedValue(CONVERSATIONS);
    api.getConversation.mockImplementation(async (id) =>
      id === "c1" ? C1_MESSAGES : C2_MESSAGES
    );

    renderChat();
    await screen.findByText("First question");

    // The fetch is still in flight when the user switches conversation.
    typeQuestion("still thinking?");
    clickSend();
    await flushPromises();
    expect(api.askQuestion).toHaveBeenCalledTimes(1);
    expect(screen.getByText("still thinking?")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Second chat"));
    expect(await screen.findByText("Second convo question")).toBeInTheDocument();

    // The late reply must not be appended to the newly opened pane — the
    // server persists it into the conversation it was asked in.
    await act(async () => {
      resolveAsk({ answer: "late-arriving answer" });
    });
    await flushPromises();
    expect(screen.queryByText("late-arriving answer")).not.toBeInTheDocument();
  });

  it("drops a /query reply that resolves after '+ New chat'", async () => {
    let resolveAsk;
    api.askQuestion.mockReturnValue(
      new Promise((resolve) => {
        resolveAsk = resolve;
      })
    );
    api.getConversations.mockResolvedValue(CONVERSATIONS);
    api.getConversation.mockImplementation(async (id) =>
      id === "c1" ? C1_MESSAGES : C2_MESSAGES
    );

    renderChat();
    await screen.findByText("First question");

    typeQuestion("slow question");
    clickSend();
    await flushPromises();
    expect(api.askQuestion).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "+ New chat" }));
    await flushPromises();
    expect(screen.queryByText("slow question")).not.toBeInTheDocument();

    await act(async () => {
      resolveAsk({ answer: "too late" });
    });
    await flushPromises();
    expect(screen.queryByText("too late")).not.toBeInTheDocument();
  });

  it("disables the send button while conversation history is loading", async () => {
    let resolveConversation;
    api.getConversations.mockResolvedValue(CONVERSATIONS);
    api.getConversation.mockReturnValue(
      new Promise((resolve) => {
        resolveConversation = resolve;
      })
    );

    renderChat();
    typeQuestion("queued?");
    expect(document.querySelector(".send-button")).toBeDisabled();

    await act(async () => {
      resolveConversation(C1_MESSAGES);
    });
    expect(await screen.findByText("First question")).toBeInTheDocument();
    expect(document.querySelector(".send-button")).not.toBeDisabled();
  });

  it("shows a retryable sidebar error when the conversation list fails", async () => {
    api.getConversations.mockRejectedValueOnce({
      response: { status: 500 },
    });

    renderChat();
    expect(
      await screen.findByText("Could not load conversations.")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No conversations yet.")
    ).not.toBeInTheDocument();

    // Retry refetches; the recovered list renders normally. A retry never
    // auto-opens a conversation — the user picks one themselves (an
    // auto-open here could clobber a "+ New chat" pane).
    api.getConversations.mockResolvedValue(CONVERSATIONS);
    api.getConversation.mockImplementation(async (id) =>
      id === "c1" ? C1_MESSAGES : C2_MESSAGES
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("First chat")).toBeInTheDocument();
    expect(
      screen.queryByText("Could not load conversations.")
    ).not.toBeInTheDocument();
    expect(api.getConversation).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("First chat"));
    expect(await screen.findByText("First question")).toBeInTheDocument();
  });

  it("loads a conversation's messages when its sidebar item is clicked", async () => {
    api.getConversations.mockResolvedValue(CONVERSATIONS);
    api.getConversation.mockImplementation(async (id) =>
      id === "c1" ? C1_MESSAGES : C2_MESSAGES
    );

    renderChat();
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

    renderChat();
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

    renderChat();
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

    renderChat();
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
    renderChat();
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
    renderChat();
    await screen.findByText("No conversations yet.");

    typeQuestion("Trigger the retry");
    clickSend();
    await flushPromises();

    expect(api.askQuestion).toHaveBeenNthCalledWith(1, {
      query: "Trigger the retry",
      conversationId: "conv-new",
      document: "egyptian_history",
    });
    // Second attempt drops the conversation payload — the chosen corpus
    // is kept so the retry can't silently answer from the wrong document.
    expect(api.askQuestion).toHaveBeenNthCalledWith(2, {
      query: "Trigger the retry",
      document: "egyptian_history",
    });
    expect(api.askQuestion).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("ok")).toBeInTheDocument();
  });

  it("falls back to plain /query when the conversation API is missing", async () => {
    api.getConversations.mockRejectedValue({ response: { status: 404 } });
    renderChat();
    await screen.findByText("No conversations yet.");

    // "What is this?" would trip the vague-question guard — ask a real one.
    typeQuestion("Who built the pyramids?");
    clickSend();
    await flushPromises();

    expect(api.createConversation).not.toHaveBeenCalled();
    expect(api.askQuestion).toHaveBeenCalledWith({
      query: "Who built the pyramids?",
      document: "egyptian_history",
    });
  });

  it("clears the chat when the auth token is removed in another tab", async () => {
    api.getConversations.mockResolvedValue(CONVERSATIONS);
    api.getConversation.mockImplementation(async (id) =>
      id === "c1" ? C1_MESSAGES : C2_MESSAGES
    );

    renderChat();
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

  it("lists indexed documents in the picker and disables unindexed ones", async () => {
    renderChat();
    await screen.findByText("No conversations yet.");

    const select = screen.getByLabelText("Document to answer from");
    expect(select).toHaveValue("egyptian_history");

    // Indexed documents are selectable; the still-uploading one shows up
    // disabled so it can't be aimed at /query.
    expect(
      await screen.findByRole("option", { name: "egyptian_history.pdf" })
    ).toBeEnabled();
    expect(
      await screen.findByRole("option", { name: "Alexandria Guide.pdf" })
    ).toBeEnabled();
    expect(
      await screen.findByRole("option", {
        name: "fresh_upload.pdf (not indexed)",
      })
    ).toBeDisabled();
  });

  it("sends the picked document with the next query", async () => {
    renderChat();
    await screen.findByText("No conversations yet.");

    // Wait for the fetched options so the select has a matching <option>.
    await screen.findByRole("option", { name: "Alexandria Guide.pdf" });
    fireEvent.change(
      screen.getByLabelText("Document to answer from"),
      { target: { value: "alexandria_guide" } }
    );

    typeQuestion("Tell me about the citadel");
    clickSend();
    await flushPromises();

    expect(api.askQuestion).toHaveBeenCalledWith({
      query: "Tell me about the citadel",
      conversationId: "conv-new",
      document: "alexandria_guide",
    });
  });

  it("applies a document change only to the next send", async () => {
    let resolveAsk;
    api.askQuestion.mockReturnValue(
      new Promise((resolve) => {
        resolveAsk = resolve;
      })
    );
    renderChat();
    await screen.findByText("No conversations yet.");

    vi.useFakeTimers();

    // A query is in flight against the default corpus when the user
    // switches the picker — the in-flight request keeps its document.
    typeQuestion("First query");
    clickSend();
    await flushPromises();
    expect(api.askQuestion).toHaveBeenCalledWith({
      query: "First query",
      conversationId: "conv-new",
      document: "egyptian_history",
    });

    // Options already rendered during the mount flush — a sync query is
    // used here because findBy* polling can't advance under fake timers.
    screen.getByRole("option", { name: "Alexandria Guide.pdf" });
    fireEvent.change(
      screen.getByLabelText("Document to answer from"),
      { target: { value: "alexandria_guide" } }
    );

    api.askQuestion.mockResolvedValue({ answer: "ok" });
    await act(async () => {
      resolveAsk({ answer: "a short ok" });
    });
    await flushPromises();
    await act(async () => {
      vi.runAllTimers();
    });

    typeQuestion("Second query");
    clickSend();
    await flushPromises();
    expect(api.askQuestion).toHaveBeenLastCalledWith({
      query: "Second query",
      conversationId: "conv-new",
      document: "alexandria_guide",
    });
  });

  it("refetches the document list when the picker is focused", async () => {
    renderChat();
    const select = await screen.findByLabelText("Document to answer from");
    expect(api.getDocuments).toHaveBeenCalledTimes(1);

    fireEvent.focus(select);
    await flushPromises();
    expect(api.getDocuments).toHaveBeenCalledTimes(2);
  });

  it("calls api.logout from the header logout button", async () => {
    renderChat();
    await screen.findByText("No conversations yet.");

    // jsdom reports the resulting navigation as "not implemented" — that's
    // expected noise; what matters is the session teardown.
    fireEvent.click(screen.getByRole("button", { name: "Logout" }));
    expect(api.logout).toHaveBeenCalled();
  });

  it("recovers from a stale conversationId by creating a fresh conversation", async () => {
    api.getConversations.mockResolvedValue(CONVERSATIONS);
    api.getConversation.mockImplementation(async (id) =>
      id === "c1" ? C1_MESSAGES : C2_MESSAGES
    );
    api.askQuestion
      .mockRejectedValueOnce({
        response: {
          status: 404,
          data: { message: "Conversation not found" },
        },
      })
      .mockResolvedValueOnce({ answer: "recovered" });
    api.createConversation.mockResolvedValue({ _id: "conv-fresh" });

    renderChat();
    await screen.findByText("First question");
    expect(localStorage.getItem(`conversationId_${USER_ID}`)).toBe("c1");

    typeQuestion("still there?");
    clickSend();
    await flushPromises();

    // First attempt went out with the stale id; the retry created a fresh
    // conversation and attached its id instead of 404ing forever.
    expect(api.askQuestion).toHaveBeenNthCalledWith(1, {
      query: "still there?",
      conversationId: "c1",
      document: "egyptian_history",
    });
    expect(api.createConversation).toHaveBeenCalledWith({
      title: "still there?",
    });
    expect(api.askQuestion).toHaveBeenNthCalledWith(2, {
      query: "still there?",
      conversationId: "conv-fresh",
      document: "egyptian_history",
    });
    expect(api.askQuestion).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("recovered")).toBeInTheDocument();
    expect(localStorage.getItem(`conversationId_${USER_ID}`)).toBe(
      "conv-fresh"
    );
  });

  it("does not activate a conversation whose message fetch fails", async () => {
    api.getConversations.mockResolvedValue(CONVERSATIONS);
    api.getConversation.mockRejectedValue({ response: { status: 404 } });

    renderChat();
    expect(await screen.findByText("First chat")).toBeInTheDocument();

    // The dead id is neither activated nor persisted — a send must not
    // attach it (it would 404 every time).
    expect(
      document.querySelector(".conversation-item.active")
    ).toBeNull();
    expect(localStorage.getItem(`conversationId_${USER_ID}`)).toBeNull();

    typeQuestion("fresh start");
    clickSend();
    await flushPromises();

    expect(api.createConversation).toHaveBeenCalledWith({
      title: "fresh start",
    });
    expect(api.askQuestion).toHaveBeenCalledWith({
      query: "fresh start",
      conversationId: "conv-new",
      document: "egyptian_history",
    });
  });

  it("shows a non-conversation 400 without disabling persistence", async () => {
    api.getConversations.mockResolvedValue(CONVERSATIONS);
    api.getConversation.mockImplementation(async (id) =>
      id === "c1" ? C1_MESSAGES : C2_MESSAGES
    );
    api.askQuestion.mockRejectedValueOnce({
      response: {
        status: 400,
        data: { message: "Question is too long (max 2000 characters)" },
      },
    });

    renderChat();
    await screen.findByText("First question");

    typeQuestion("too long");
    clickSend();
    await flushPromises();

    // A labeled non-conversation 400 is shown to the user as-is — no
    // silent plain-query retry.
    expect(
      await screen.findByText("Question is too long (max 2000 characters)")
    ).toBeInTheDocument();
    expect(api.askQuestion).toHaveBeenCalledTimes(1);

    // Persistence stays enabled — the next send still attaches the id.
    api.askQuestion.mockResolvedValueOnce({ answer: "ok" });
    typeQuestion("next");
    clickSend();
    await flushPromises();
    expect(api.askQuestion).toHaveBeenLastCalledWith({
      query: "next",
      conversationId: "c1",
      document: "egyptian_history",
    });
  });

  it("does not auto-open a conversation when a retry resolves after '+ New chat'", async () => {
    api.getConversations.mockRejectedValueOnce({
      response: { status: 500 },
    });

    renderChat();
    expect(
      await screen.findByText("Could not load conversations.")
    ).toBeInTheDocument();

    // The user opts for a fresh empty pane, then retries the sidebar.
    fireEvent.click(screen.getByRole("button", { name: "+ New chat" }));
    api.getConversations.mockResolvedValue(CONVERSATIONS);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    // The list recovers, but nothing is auto-opened over their empty pane.
    expect(await screen.findByText("First chat")).toBeInTheDocument();
    expect(api.getConversation).not.toHaveBeenCalled();
    expect(
      document.querySelector(".conversation-item.active")
    ).toBeNull();
    expect(localStorage.getItem(`conversationId_${USER_ID}`)).toBeNull();
  });

  it("resets the corpus selection when the picked document is no longer indexed", async () => {
    renderChat();
    await screen.findByText("No conversations yet.");

    const select = await screen.findByLabelText("Document to answer from");
    await screen.findByRole("option", { name: "Alexandria Guide.pdf" });
    fireEvent.change(select, { target: { value: "alexandria_guide" } });
    expect(select).toHaveValue("alexandria_guide");

    // The next refresh reports the picked document unindexed — the
    // selection falls back to the default corpus instead of aiming
    // /query at a document the backend would reject.
    api.getDocuments.mockResolvedValue({
      documents: [DOCUMENTS[0], { ...DOCUMENTS[1], indexed: false }],
    });
    fireEvent.focus(select);
    await flushPromises();

    expect(select).toHaveValue("egyptian_history");
  });

  it("does not refetch the sidebar after a plain /query send", async () => {
    api.getConversations.mockRejectedValue({ response: { status: 404 } });
    renderChat();
    await screen.findByText("No conversations yet.");
    expect(api.getConversations).toHaveBeenCalledTimes(1);

    typeQuestion("Who built the pyramids?");
    clickSend();
    await flushPromises();

    expect(api.askQuestion).toHaveBeenCalledTimes(1);
    // Nothing persisted — refreshing the list would be a wasted fetch.
    expect(api.getConversations).toHaveBeenCalledTimes(1);
  });

  it("caps the composer at the backend's 2000-character limit", async () => {
    renderChat();
    await screen.findByText("No conversations yet.");
    expect(
      screen.getByPlaceholderText("Type your message...")
    ).toHaveAttribute("maxLength", "2000");
  });
});
