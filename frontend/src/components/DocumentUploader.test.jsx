import { act, fireEvent, render, screen } from "@testing-library/react";
import DocumentUploader from "./DocumentUploader";
import api from "../services/api";

vi.mock("../services/api", () => ({
  default: {
    uploadDocument: vi.fn(),
  },
}));

const flushPromises = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });

const selectFile = (file) => {
  const input = document.querySelector('input[type="file"]');
  fireEvent.change(input, { target: { files: [file] } });
};

const pdfFile = () =>
  new File(["%PDF-1.4 fake"], "egypt.pdf", { type: "application/pdf" });

describe("DocumentUploader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.uploadDocument.mockResolvedValue({ filename: "egypt.pdf" });
  });

  it("renders the form with the upload button disabled until a file is chosen", () => {
    render(<DocumentUploader />);
    expect(
      screen.getByRole("heading", { name: "Upload Egyptian History Document" })
    ).toBeInTheDocument();
    const input = document.querySelector('input[type="file"]');
    expect(input).toHaveAttribute("accept", ".pdf");
    expect(
      screen.getByRole("button", { name: "Upload Document" })
    ).toBeDisabled();
  });

  it("enables the upload button once a file is selected", () => {
    render(<DocumentUploader />);
    selectFile(pdfFile());
    expect(
      screen.getByRole("button", { name: "Upload Document" })
    ).toBeEnabled();
  });

  it("uploads the file, shows the result, and notifies the parent", async () => {
    const onDocumentUploaded = vi.fn();
    render(<DocumentUploader onDocumentUploaded={onDocumentUploaded} />);

    const file = pdfFile();
    selectFile(file);
    fireEvent.click(screen.getByRole("button", { name: "Upload Document" }));
    await flushPromises();

    expect(api.uploadDocument).toHaveBeenCalledWith(file);
    expect(
      await screen.findByText("Document uploaded successfully: egypt.pdf")
    ).toBeInTheDocument();
    expect(onDocumentUploaded).toHaveBeenCalledTimes(1);
    // The file state resets after the upload finishes — including the
    // uncontrolled input, so the same file can be picked again.
    expect(
      screen.getByRole("button", { name: "Upload Document" })
    ).toBeDisabled();
    expect(document.querySelector('input[type="file"]')).toHaveValue("");
  });

  it("works without the onDocumentUploaded callback", async () => {
    render(<DocumentUploader />);
    selectFile(pdfFile());
    fireEvent.click(screen.getByRole("button", { name: "Upload Document" }));
    expect(
      await screen.findByText("Document uploaded successfully: egypt.pdf")
    ).toBeInTheDocument();
  });

  it("falls back to the chosen file's name when the response has no filename", async () => {
    api.uploadDocument.mockResolvedValue({ success: true });
    render(<DocumentUploader />);

    selectFile(pdfFile());
    fireEvent.click(screen.getByRole("button", { name: "Upload Document" }));

    expect(
      await screen.findByText("Document uploaded successfully: egypt.pdf")
    ).toBeInTheDocument();
  });

  it("shows the server-provided error message on failure", async () => {
    api.uploadDocument.mockRejectedValue({
      response: { data: { message: "Only PDF files are allowed!" } },
    });
    render(<DocumentUploader />);

    selectFile(pdfFile());
    fireEvent.click(screen.getByRole("button", { name: "Upload Document" }));

    expect(
      await screen.findByText("Error: Only PDF files are allowed!")
    ).toBeInTheDocument();
  });

  it("falls back to a generic message when the error has no response", async () => {
    api.uploadDocument.mockRejectedValue(new Error("network"));
    render(<DocumentUploader />);

    selectFile(pdfFile());
    fireEvent.click(screen.getByRole("button", { name: "Upload Document" }));

    expect(
      await screen.findByText("Error: Failed to upload document")
    ).toBeInTheDocument();
  });

  it("shows progress and disables the input while uploading", async () => {
    let resolveUpload;
    api.uploadDocument.mockReturnValue(
      new Promise((resolve) => {
        resolveUpload = resolve;
      })
    );
    render(<DocumentUploader />);

    selectFile(pdfFile());
    fireEvent.click(screen.getByRole("button", { name: "Upload Document" }));

    expect(
      await screen.findByText("Uploading document...")
    ).toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Uploading..." })
    ).toBeDisabled();

    await act(async () => {
      resolveUpload({ filename: "egypt.pdf" });
    });
    expect(
      await screen.findByText("Document uploaded successfully: egypt.pdf")
    ).toBeInTheDocument();
  });
});
