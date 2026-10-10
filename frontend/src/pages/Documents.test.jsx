import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Documents from "./Documents";

// Children are stubbed so this test only covers the page's composition and
// the refresh-on-upload wiring (DocumentManager remounts via key change).
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

// The page renders a react-router <Link>, so renders need a Router.
const renderPage = () =>
  render(
    <MemoryRouter>
      <Documents />
    </MemoryRouter>
  );

describe("Documents page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the Knowledge Base section with navigation", () => {
    renderPage();
    expect(
      screen.getByRole("heading", { name: "Knowledge Base" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /back to chat/i })
    ).toHaveAttribute("href", "/chat");
    expect(screen.getByRole("button", { name: "Logout" })).toBeInTheDocument();
    expect(screen.getByTestId("uploader")).toBeInTheDocument();
    expect(screen.getByTestId("doc-manager")).toBeInTheDocument();
  });

  it("remounts DocumentManager when the uploader signals a new document", () => {
    renderPage();
    expect(managerMounts).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("uploader"));

    // The key bump forces a fresh mount so the document list refetches.
    expect(managerUnmounts).toHaveBeenCalledTimes(1);
    expect(managerMounts).toHaveBeenCalledTimes(2);
  });
});
