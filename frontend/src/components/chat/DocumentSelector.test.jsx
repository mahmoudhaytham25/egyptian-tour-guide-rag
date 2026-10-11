import { fireEvent, render, screen } from "@testing-library/react";
import DocumentSelector from "./DocumentSelector";

const DOCS = [
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

const renderPicker = (props = {}) =>
  render(
    <DocumentSelector
      documents={DOCS}
      value="egyptian_history"
      onChange={vi.fn()}
      onRefresh={vi.fn()}
      {...props}
    />
  );

describe("DocumentSelector", () => {
  it("renders an option per document with friendly names", () => {
    renderPicker();

    expect(
      screen.getByRole("option", { name: "egyptian_history.pdf" })
    ).toBeEnabled();
    expect(
      screen.getByRole("option", { name: "Alexandria Guide.pdf" })
    ).toBeEnabled();
    // Unindexed documents are listed but can't be selected — querying one
    // would 404 on the model server.
    expect(
      screen.getByRole("option", { name: "fresh_upload.pdf (not indexed)" })
    ).toBeDisabled();
  });

  it("reports a selection change and asks for a refresh on focus", () => {
    const onChange = vi.fn();
    const onRefresh = vi.fn();
    renderPicker({ onChange, onRefresh });

    const select = screen.getByLabelText("Document to answer from");
    fireEvent.focus(select);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    fireEvent.change(select, { target: { value: "alexandria_guide" } });
    expect(onChange).toHaveBeenCalledWith("alexandria_guide");
  });

  it("keeps a selected value missing from the list selectable", () => {
    renderPicker({ documents: [], value: "egyptian_history" });

    // Without a fallback option the select would render blank.
    const select = screen.getByLabelText("Document to answer from");
    expect(select).toHaveValue("egyptian_history");
    expect(select.querySelectorAll("option")).toHaveLength(1);
  });
});
