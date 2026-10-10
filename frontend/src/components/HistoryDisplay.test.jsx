import { fireEvent, render, screen } from "@testing-library/react";
import HistoryDisplay from "./HistoryDisplay";

const noop = () => {};

const renderSidebar = (props = {}) =>
  render(
    <HistoryDisplay
      conversations={[]}
      activeConversationId={null}
      onSelect={noop}
      onNewChat={noop}
      onDelete={noop}
      {...props}
    />
  );

const CONVERSATIONS = [
  { _id: "c1", title: "Pyramids chat", updatedAt: "2026-01-01T10:00:00Z" },
  { _id: "c2", title: "Temples chat", updatedAt: "2026-01-02T10:00:00Z" },
];

describe("HistoryDisplay", () => {
  it("renders the empty state when there are no conversations", () => {
    renderSidebar();
    expect(screen.getByText("No conversations yet.")).toBeInTheDocument();
    expect(
      screen.getByText("Start a new chat and it will show up here.")
    ).toBeInTheDocument();
  });

  it("renders every conversation title", () => {
    renderSidebar({ conversations: CONVERSATIONS });
    expect(screen.getByText("Pyramids chat")).toBeInTheDocument();
    expect(screen.getByText("Temples chat")).toBeInTheDocument();
  });

  it("falls back to 'Untitled chat' for blank or missing titles", () => {
    renderSidebar({
      conversations: [
        { _id: "c1", title: "   " },
        { _id: "c2" },
      ],
    });
    expect(screen.getAllByText("Untitled chat")).toHaveLength(2);
  });

  it("marks only the active conversation", () => {
    renderSidebar({ conversations: CONVERSATIONS, activeConversationId: "c2" });
    const items = document.querySelectorAll(".conversation-item");
    expect(items[0]).not.toHaveClass("active");
    expect(items[1]).toHaveClass("active");
  });

  it("formats today's timestamps as a time and older ones as a date", () => {
    const now = new Date();
    const old = new Date("2020-03-04T10:00:00Z");
    renderSidebar({
      conversations: [
        { _id: "c1", title: "Recent", updatedAt: now.toISOString() },
        { _id: "c2", title: "Old", updatedAt: old.toISOString() },
      ],
    });

    const dates = document.querySelectorAll(".conversation-date");
    expect(dates[0].textContent).toBe(
      now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    );
    expect(dates[1].textContent).toBe(
      old.toLocaleDateString([], {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    );
  });

  it("renders an empty date label for missing or invalid timestamps", () => {
    renderSidebar({
      conversations: [
        { _id: "c1", title: "No date" },
        { _id: "c2", title: "Bad date", updatedAt: "not-a-date" },
      ],
    });
    const dates = document.querySelectorAll(".conversation-date");
    expect(dates[0].textContent).toBe("");
    expect(dates[1].textContent).toBe("");
  });

  it("calls onSelect when a conversation is clicked or activated by keyboard", () => {
    const onSelect = vi.fn();
    renderSidebar({ conversations: CONVERSATIONS, onSelect });

    fireEvent.click(screen.getByText("Pyramids chat"));
    expect(onSelect).toHaveBeenCalledWith(CONVERSATIONS[0]);

    onSelect.mockClear();
    const item = screen.getByText("Temples chat").closest(".conversation-item");
    fireEvent.keyDown(item, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(CONVERSATIONS[1]);

    onSelect.mockClear();
    fireEvent.keyDown(item, { key: " " });
    expect(onSelect).toHaveBeenCalledWith(CONVERSATIONS[1]);
  });

  it("calls onNewChat from the header button", () => {
    const onNewChat = vi.fn();
    renderSidebar({ onNewChat });
    fireEvent.click(screen.getByRole("button", { name: "+ New chat" }));
    expect(onNewChat).toHaveBeenCalledTimes(1);
  });

  it("calls onDelete without triggering onSelect", () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    renderSidebar({ conversations: CONVERSATIONS, onSelect, onDelete });

    const deleteButtons = screen.getAllByRole("button", {
      name: "Delete conversation",
    });
    fireEvent.click(deleteButtons[0]);

    expect(onDelete).toHaveBeenCalledWith(CONVERSATIONS[0]);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
