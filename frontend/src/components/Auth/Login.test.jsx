import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import api from "../../services/api";
import Login from "./Login";

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));

vi.mock("../../services/api", () => ({
  default: {
    login: vi.fn(),
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

const renderLogin = () =>
  render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>
  );

describe("Login", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    // clearAllMocks doesn't reset mockReturnValue — re-default the guard.
    api.isAuthenticated.mockReturnValue(false);
  });

  it("renders the form with a link to registration", () => {
    renderLogin();
    expect(
      screen.getByRole("heading", { name: /sign in/i })
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Email")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Login" })).toBeEnabled();
    expect(
      screen.getByRole("link", { name: /register here/i })
    ).toHaveAttribute("href", "/register");
  });

  it("posts the credentials and navigates to /chat on success", async () => {
    const user = userEvent.setup();
    api.login.mockResolvedValue({ token: "jwt-1" });
    renderLogin();

    await user.type(screen.getByPlaceholderText("Email"), "user@example.com");
    await user.type(screen.getByPlaceholderText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Login" }));

    expect(api.login).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "password123",
    });
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/chat"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the server-provided message on a failed login", async () => {
    const user = userEvent.setup();
    api.login.mockRejectedValue({
      response: { data: { message: "Invalid credentials." } },
    });
    renderLogin();

    await user.type(screen.getByPlaceholderText("Email"), "user@example.com");
    await user.type(screen.getByPlaceholderText("Password"), "wrong-pass");
    await user.click(screen.getByRole("button", { name: "Login" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid credentials."
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("falls back to a network error message when there is no response", async () => {
    const user = userEvent.setup();
    api.login.mockRejectedValue({ request: {} });
    renderLogin();

    await user.type(screen.getByPlaceholderText("Email"), "user@example.com");
    await user.type(screen.getByPlaceholderText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Login" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Network error. Please check your connection and try again."
    );
  });

  it("shows a generic message for non-request failures", async () => {
    const user = userEvent.setup();
    api.login.mockRejectedValue(new Error("boom"));
    renderLogin();

    await user.type(screen.getByPlaceholderText("Email"), "user@example.com");
    await user.type(screen.getByPlaceholderText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Login" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Login failed. Please try again."
    );
  });

  it("redirects to /chat when the user is already authenticated", async () => {
    api.isAuthenticated.mockReturnValue(true);
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/chat" element={<div>Chat Page</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Chat Page")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Email")).not.toBeInTheDocument();
    expect(api.login).not.toHaveBeenCalled();
  });

  it("disables the button while submitting and ignores repeat submits", async () => {
    const user = userEvent.setup();
    let resolveLogin;
    api.login.mockReturnValue(
      new Promise((resolve) => {
        resolveLogin = resolve;
      })
    );
    renderLogin();

    await user.type(screen.getByPlaceholderText("Email"), "user@example.com");
    await user.type(screen.getByPlaceholderText("Password"), "password123");

    const button = screen.getByRole("button", { name: "Login" });
    await user.click(button);

    const pendingButton = await screen.findByRole("button", {
      name: "Signing in...",
    });
    expect(pendingButton).toBeDisabled();
    // A second click while the request is in flight must not re-submit.
    await user.click(pendingButton);
    expect(api.login).toHaveBeenCalledTimes(1);

    resolveLogin({ token: "jwt-1" });
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/chat"));
  });
});
