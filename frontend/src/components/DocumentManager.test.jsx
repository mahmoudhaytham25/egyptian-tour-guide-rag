import { act, fireEvent, render, screen } from "@testing-library/react";
import DocumentManager from "./DocumentManager";
import api from "../services/api";

vi.mock("../services/api", () => ({
  default: {
    getDocuments: vi.fn(),
    getIndexingStatus: vi.fn(),
    indexDocument: vi.fn(),
  },
}));

const flushPromises = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });

const DOCS = [
  {
    id: "guide",
    filename: "guide.pdf",
    originalName: "Nile Guide.pdf",
    indexed: false,
  },
  {
    id: "temples",
    filename: "temples.pdf",
    originalName: "Temples.pdf",
    indexed: true,
  },
];

describe("DocumentManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getDocuments.mockResolvedValue({ documents: [] });
    api.getIndexingStatus.mockResolvedValue({
      status: { isIndexing: false, lastIndexed: null },
    });
    api.indexDocument.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows a loading indicator, then splits documents by indexed state", async () => {
    let resolveDocs;
    api.getDocuments.mockReturnValue(
      new Promise((resolve) => {
        resolveDocs = resolve;
      })
    );

    render(<DocumentManager />);
    expect(screen.getByText("Loading documents...")).toBeInTheDocument();

    await act(async () => {
      resolveDocs({ documents: DOCS });
    });

    expect(
      screen.queryByText("Loading documents...")
    ).not.toBeInTheDocument();
    // Unindexed docs get an Index button; indexed ones get a badge.
    expect(screen.getByText("Nile Guide.pdf")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Index Document" })
    ).toBeEnabled();
    expect(screen.getByText("Temples.pdf")).toBeInTheDocument();
    expect(screen.getByText("Indexed")).toBeInTheDocument();
  });

  it("renders empty-state copy for both sections when there are no documents", async () => {
    render(<DocumentManager />);
    expect(
      await screen.findByText("No unindexed documents available.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("No indexed documents available.")
    ).toBeInTheDocument();
  });

  it("shows a failure message when the document list cannot be fetched", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    api.getDocuments.mockRejectedValue(new Error("network"));

    render(<DocumentManager />);

    expect(
      await screen.findByText("Failed to load documents")
    ).toBeInTheDocument();
  });

  it("falls back to the raw filename when originalName is absent", async () => {
    api.getDocuments.mockResolvedValue({
      documents: [{ id: "x", filename: "raw-file.pdf", indexed: false }],
    });

    render(<DocumentManager />);

    expect(await screen.findByText("raw-file.pdf")).toBeInTheDocument();
  });

  it("starts indexing on click and locks the button while polling", async () => {
    api.getDocuments.mockResolvedValue({
      documents: [
        {
          id: "guide",
          filename: "guide.pdf",
          originalName: "Nile Guide.pdf",
          indexed: false,
        },
      ],
    });

    render(<DocumentManager />);
    const button = await screen.findByRole("button", {
      name: "Index Document",
    });

    fireEvent.click(button);
    await flushPromises();

    expect(api.indexDocument).toHaveBeenCalledWith("guide.pdf");
    expect(
      screen.getByText("Indexing process started for guide.pdf")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Indexing..." })
    ).toBeDisabled();
  });

  it("reports the failure and re-enables the button when indexing fails to start", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    api.indexDocument.mockRejectedValue({
      response: { data: { message: "Index is busy" } },
    });
    api.getDocuments.mockResolvedValue({
      documents: [{ id: "guide", filename: "guide.pdf", indexed: false }],
    });

    render(<DocumentManager />);
    const button = await screen.findByRole("button", {
      name: "Index Document",
    });

    fireEvent.click(button);
    await flushPromises();

    expect(screen.getByText("Error: Index is busy")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Index Document" })
    ).toBeEnabled();
  });

  it("polls indexing status when indexing is already running at mount", async () => {
    api.getIndexingStatus.mockResolvedValue({
      status: { isIndexing: true, progress: 42 },
    });
    // Fake timers must be installed before render so the 2s interval is
    // created under them.
    vi.useFakeTimers();

    render(<DocumentManager />);
    await flushPromises();
    const callsAtMount = api.getIndexingStatus.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(api.getIndexingStatus.mock.calls.length).toBeGreaterThan(
      callsAtMount
    );
    expect(
      screen.getByText("Indexing in progress: 42%")
    ).toBeInTheDocument();
  });

  it("labels only the document actually indexing as 'Indexing...'", async () => {
    api.getDocuments.mockResolvedValue({
      documents: [
        { id: "a", filename: "a.pdf", indexed: false },
        { id: "b", filename: "b.pdf", indexed: false },
      ],
    });

    render(<DocumentManager />);
    const buttons = await screen.findAllByRole("button", {
      name: "Index Document",
    });
    fireEvent.click(buttons[0]);
    await flushPromises();

    expect(api.indexDocument).toHaveBeenCalledWith("a.pdf");
    const indexingButton = screen.getByRole("button", {
      name: "Indexing...",
    });
    expect(indexingButton).toBeDisabled();
    expect(indexingButton.closest("li")).toHaveTextContent("a.pdf");
    // The other document is busy-disabled while a job runs, but keeps its
    // normal label — it's not the one being indexed.
    const idleButton = screen.getByRole("button", { name: "Index Document" });
    expect(idleButton).toBeDisabled();
    expect(idleButton.closest("li")).toHaveTextContent("b.pdf");
  });

  it("labels the in-flight document when indexing is already running at mount", async () => {
    api.getDocuments.mockResolvedValue({
      documents: [
        { id: "a", filename: "a.pdf", indexed: false },
        { id: "b", filename: "b.pdf", indexed: false },
      ],
    });
    api.getIndexingStatus.mockResolvedValue({
      status: { isIndexing: true, progress: 10, currentFile: "b.pdf" },
    });

    render(<DocumentManager />);
    await flushPromises();

    // currentFile identifies the job's target — only that row gets the
    // 'Indexing...' label even though both buttons are disabled.
    const indexingButton = screen.getByRole("button", {
      name: "Indexing...",
    });
    expect(indexingButton).toBeDisabled();
    expect(indexingButton.closest("li")).toHaveTextContent("b.pdf");
    const idleButton = screen.getByRole("button", { name: "Index Document" });
    expect(idleButton).toBeDisabled();
    expect(idleButton.closest("li")).toHaveTextContent("a.pdf");
  });

  it("refreshes the list on completion, then stops polling and clears the status", async () => {
    api.getIndexingStatus
      .mockResolvedValueOnce({ status: { isIndexing: true, progress: 90 } })
      .mockResolvedValue({
        status: {
          isIndexing: false,
          lastIndexed: "2026-01-01T12:00:00Z",
        },
      });
    vi.useFakeTimers();

    render(<DocumentManager />);
    await flushPromises();
    const docCallsAtMount = api.getDocuments.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(
      screen.getByText(/Indexing completed at /)
    ).toBeInTheDocument();
    // Completion triggers a document-list refresh.
    expect(api.getDocuments.mock.calls.length).toBeGreaterThan(
      docCallsAtMount
    );

    // The completion message clears after 3s and the interval is removed.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(
      screen.queryByText(/Indexing completed at /)
    ).not.toBeInTheDocument();

    const statusCalls = api.getIndexingStatus.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(api.getIndexingStatus.mock.calls.length).toBe(statusCalls);
  });
});
