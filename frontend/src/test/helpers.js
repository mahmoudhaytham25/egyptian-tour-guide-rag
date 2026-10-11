// Shared test helpers: JWT builders for the auth storage checks and a
// microtask flusher for driving a component's async handlers to completion.
import { act } from "@testing-library/react";

// Build an unsigned JWT-shaped token — the frontend only decodes the
// payload, never verifies the signature (that's the backend's job).
export const makeJwt = (payload) => {
  const segment = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${segment}.signature`;
};

export const futureExp = () => Math.floor(Date.now() / 1000) + 3600;
export const pastExp = () => Math.floor(Date.now() / 1000) - 3600;

// Flush the promise chains inside a component's async handlers without
// touching (fake) timers — needed between a UI action and its awaited result.
export const flushPromises = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
