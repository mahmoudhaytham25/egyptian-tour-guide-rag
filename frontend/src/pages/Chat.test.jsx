import { render, screen } from "@testing-library/react";
import Chat from "./Chat";

vi.mock("../components/ChatInterface", () => ({
  default: () => <div data-testid="chat-interface" />,
}));

describe("Chat page", () => {
  it("renders ChatInterface inside the page layout", () => {
    render(<Chat />);
    const main = screen.getByRole("main");
    expect(main).toHaveClass("chat-page");
    expect(screen.getByTestId("chat-interface")).toBeInTheDocument();
  });
});
