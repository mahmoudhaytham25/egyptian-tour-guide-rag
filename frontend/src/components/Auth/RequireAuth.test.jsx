import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import RequireAuth from "./RequireAuth";
import { makeJwt, futureExp, pastExp } from "../../test/helpers";

// Uses the real api service (localStorage-backed) so the guard is exercised
// end to end, including the stale-token cleanup on the way out.
const renderGuarded = () =>
  render(
    <MemoryRouter initialEntries={["/protected"]}>
      <Routes>
        <Route path="/" element={<div>Login Page</div>} />
        <Route
          path="/protected"
          element={
            <RequireAuth>
              <div>Secret Content</div>
            </RequireAuth>
          }
        />
      </Routes>
    </MemoryRouter>
  );

describe("RequireAuth", () => {
  it("redirects to / when there is no token", () => {
    renderGuarded();
    expect(screen.getByText("Login Page")).toBeInTheDocument();
    expect(screen.queryByText("Secret Content")).not.toBeInTheDocument();
  });

  it("redirects and clears storage when the token is expired", () => {
    localStorage.setItem("authToken", makeJwt({ id: "u1", exp: pastExp() }));
    localStorage.setItem("conversationId_u1", "c1");

    renderGuarded();

    expect(screen.getByText("Login Page")).toBeInTheDocument();
    // The guard calls api.logout() on the way out — stale state is dropped.
    expect(localStorage.getItem("authToken")).toBeNull();
    expect(localStorage.getItem("conversationId_u1")).toBeNull();
  });

  it("renders children for a token with a future exp", () => {
    localStorage.setItem("authToken", makeJwt({ id: "u1", exp: futureExp() }));
    renderGuarded();
    expect(screen.getByText("Secret Content")).toBeInTheDocument();
    expect(screen.queryByText("Login Page")).not.toBeInTheDocument();
  });
});
