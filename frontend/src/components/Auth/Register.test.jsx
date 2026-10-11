import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import api from "../../services/api";
import Register from "./Register";

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));

vi.mock("../../services/api", () => ({
  default: {
    signup: vi.fn(),
    setAuthToken: vi.fn(),
    isAuthenticated: vi.fn(),
    logout: vi.fn(),
    getUserId: vi.fn(),
  },
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod, useNavigate: () => mockNavigate };
});

const renderRegister = () =>
  render(
    <MemoryRouter>
      <Register />
    </MemoryRouter>
  );

const fillForm = async (user, { email, password, confirm }) => {
  await user.type(screen.getByPlaceholderText("Email"), email);
  await user.type(screen.getByPlaceholderText("Password"), password);
  await user.type(screen.getByPlaceholderText("Confirm Password"), confirm);
};

// Submitting via the form element bypasses browser-side constraint
// validation entirely, so the component's own guards are what's tested.
const submitForm = () => {
  const form = document.querySelector("form.signupForm");
  fireEvent.submit(form);
};

describe("Register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders all three fields, the submit button, and the login link", () => {
    renderRegister();
    expect(screen.getByPlaceholderText("Email")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Password")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Confirm Password")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Register" })).toBeEnabled();
    expect(
      screen.getByRole("link", { name: /login here/i })
    ).toHaveAttribute("href", "/");
  });

  it("signs up, stores the token, and navigates to /chat", async () => {
    const user = userEvent.setup();
    api.signup.mockResolvedValue({ token: "jwt-new" });
    renderRegister();

    await fillForm(user, {
      email: "new@example.com",
      password: "password123",
      confirm: "password123",
    });
    await user.click(screen.getByRole("button", { name: "Register" }));

    expect(api.signup).toHaveBeenCalledWith({
      email: "new@example.com",
      password: "password123",
    });
    await waitFor(() => {
      expect(api.setAuthToken).toHaveBeenCalledWith("jwt-new");
      expect(mockNavigate).toHaveBeenCalledWith("/chat");
    });
  });

  it("shows an error and stays put when signup returns no token", async () => {
    const user = userEvent.setup();
    api.signup.mockResolvedValue({ message: "Signup successful." });
    renderRegister();

    await fillForm(user, {
      email: "new@example.com",
      password: "password123",
      confirm: "password123",
    });
    await user.click(screen.getByRole("button", { name: "Register" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Account created, but no session was returned. Please log in."
    );
    expect(api.setAuthToken).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("rejects empty fields without calling the API", () => {
    renderRegister();
    submitForm();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Please fill in all required fields."
    );
    expect(api.signup).not.toHaveBeenCalled();
  });

  it("rejects a password shorter than 8 characters", async () => {
    const user = userEvent.setup();
    renderRegister();

    await fillForm(user, {
      email: "new@example.com",
      password: "short",
      confirm: "short",
    });
    // fireEvent.submit bypasses the input's minLength constraint so the
    // component's own length guard is what runs.
    submitForm();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Password must be at least 8 characters."
    );
    expect(api.signup).not.toHaveBeenCalled();
  });

  it("rejects mismatched passwords and flags the confirm field invalid", async () => {
    const user = userEvent.setup();
    renderRegister();

    await fillForm(user, {
      email: "new@example.com",
      password: "password123",
      confirm: "different456",
    });
    submitForm();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Passwords do not match."
    );
    expect(screen.getByPlaceholderText("Confirm Password")).toHaveClass(
      "is-invalid"
    );
    expect(api.signup).not.toHaveBeenCalled();
  });

  it("marks the confirm field valid once the passwords match", async () => {
    const user = userEvent.setup();
    renderRegister();

    await fillForm(user, {
      email: "new@example.com",
      password: "password123",
      confirm: "password123",
    });

    expect(screen.getByPlaceholderText("Confirm Password")).toHaveClass(
      "is-valid"
    );
  });

  it("shows the server-provided message on a 409-style failure", async () => {
    const user = userEvent.setup();
    api.signup.mockRejectedValue({
      response: { data: { message: "Email already in use." } },
    });
    renderRegister();

    await fillForm(user, {
      email: "taken@example.com",
      password: "password123",
      confirm: "password123",
    });
    await user.click(screen.getByRole("button", { name: "Register" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Email already in use."
    );
  });

  it("shows a network error message when no response comes back", async () => {
    const user = userEvent.setup();
    api.signup.mockRejectedValue({ request: {} });
    renderRegister();

    await fillForm(user, {
      email: "new@example.com",
      password: "password123",
      confirm: "password123",
    });
    await user.click(screen.getByRole("button", { name: "Register" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Network error. Please check your connection and try again."
    );
  });

  it("shows a generic message for non-request failures", async () => {
    const user = userEvent.setup();
    api.signup.mockRejectedValue(new Error("boom"));
    renderRegister();

    await fillForm(user, {
      email: "new@example.com",
      password: "password123",
      confirm: "password123",
    });
    await user.click(screen.getByRole("button", { name: "Register" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Registration failed. Please try again."
    );
  });

  it("disables the button while submitting and ignores repeat submits", async () => {
    const user = userEvent.setup();
    let resolveSignup;
    api.signup.mockReturnValue(
      new Promise((resolve) => {
        resolveSignup = resolve;
      })
    );
    renderRegister();

    await fillForm(user, {
      email: "new@example.com",
      password: "password123",
      confirm: "password123",
    });
    await user.click(screen.getByRole("button", { name: "Register" }));

    const pendingButton = await screen.findByRole("button", {
      name: "Registering...",
    });
    expect(pendingButton).toBeDisabled();
    await user.click(pendingButton);
    expect(api.signup).toHaveBeenCalledTimes(1);

    resolveSignup({ token: "jwt-new" });
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/chat"));
  });
});
