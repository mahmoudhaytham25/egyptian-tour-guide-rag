import { render, screen } from "@testing-library/react";
import Chat from "./Chat";

vi.mock("../components/ChatInterface", () => ({
  default: () => <div data-testid="chat-interface" />,
}));

describe("Chat page", () => {
  it("renders ChatInterface inside the page layout", () => {
    const { container } = render(<Chat />);
    expect(container.querySelector(".chat-page")).toBeInTheDocument();
    expect(container.querySelector(".chat-page-main")).toBeInTheDocument();
    expect(screen.getByTestId("chat-interface")).toBeInTheDocument();
  });
});
