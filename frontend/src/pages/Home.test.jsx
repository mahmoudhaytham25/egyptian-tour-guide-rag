import { fireEvent, render, screen } from "@testing-library/react";
import Home from "./Home";

// Children are stubbed so this test only covers Home's composition and the
// refresh-on-upload wiring (DocumentManager remounts via key change).
const { managerMounts, managerUnmounts } = vi.hoisted(() => ({
  managerMounts: vi.fn(),
  managerUnmounts: vi.fn(),
}));

vi.mock("../components/DocumentUploader", () => ({
  default: ({ onDocumentUploaded }) => (
    <button data-testid="uploader" onClick={onDocumentUploaded}>
      Upload
    </button>
  ),
}));

vi.mock("../components/DocumentManager", async () => {
  const React = await import("react");
  return {
    default: () => {
      React.useEffect(() => {
        managerMounts();
        return () => managerUnmounts();
      }, []);
      return <div data-testid="doc-manager" />;
    },
  };
});

vi.mock("./Chat", () => ({
  default: () => <div data-testid="chat-page" />,
}));

describe("Home page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the chat plus the Knowledge Base section", () => {
    render(<Home />);
    expect(screen.getByTestId("chat-page")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Knowledge Base" })
    ).toBeInTheDocument();
    expect(screen.getByTestId("uploader")).toBeInTheDocument();
    expect(screen.getByTestId("doc-manager")).toBeInTheDocument();
  });

  it("remounts DocumentManager when the uploader signals a new document", () => {
    render(<Home />);
    expect(managerMounts).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("uploader"));

    // The key bump forces a fresh mount so the document list refetches.
    expect(managerUnmounts).toHaveBeenCalledTimes(1);
    expect(managerMounts).toHaveBeenCalledTimes(2);
  });
});
