import { test, expect } from "@playwright/test";

const API_URL = process.env.E2E_API_URL || "http://localhost:3001/api";
const PASSWORD = "e2e-password-123";

let seq = 0;
const uniqueEmail = () => `test-${Date.now()}-${seq++}@e2e.local`;

// The backend auto-verifies new accounts and returns a JWT on signup.
async function signupViaApi(request, email) {
  const res = await request.post(`${API_URL}/auth/signup`, {
    data: { email, password: PASSWORD },
  });
  expect(res.status()).toBe(201);
}

async function loginViaForm(page, email) {
  await page.goto("/");
  await page.getByPlaceholder("Email").fill(email);
  await page
    .getByPlaceholder("Password", { exact: true })
    .fill(PASSWORD);
  await page.getByRole("button", { name: "Login" }).click();
  await expect(page).toHaveURL(/\/chat$/);
}

test("registering through the form lands on the chat page", async ({
  page,
}) => {
  const email = uniqueEmail();

  await page.goto("/");
  await page.getByRole("link", { name: /register here/i }).click();
  await expect(page).toHaveURL(/\/register$/);

  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password", { exact: true }).fill(PASSWORD);
  await page.getByPlaceholder("Confirm Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Register" }).click();

  // Register navigates straight to /chat once the session is stored.
  await expect(page).toHaveURL(/\/chat$/);
  await expect(
    page.getByRole("button", { name: "+ New chat" })
  ).toBeVisible();
  await expect(page.getByText("No conversations yet.")).toBeVisible();
  await expect(
    page.getByPlaceholder("Type your message...")
  ).toBeVisible();
});

test("a new chat is persisted and appears in the sidebar", async ({
  page,
  request,
}) => {
  const email = uniqueEmail();
  await signupViaApi(request, email);
  await loginViaForm(page, email);

  await expect(
    page.getByRole("heading", { name: /Egyptian History Assistant/ })
  ).toBeVisible();

  // The Flask model server isn't part of e2e, so /api/query is fulfilled at
  // the network layer. Everything else — including the lazy
  // POST /api/chat/conversations — hits the real backend. The axios request
  // carries Authorization + JSON content type, so it triggers a CORS
  // preflight: OPTIONS is passed through to the real backend (its CORS
  // config allows the preview origin), and the fulfilled POST response
  // carries ACAO itself.
  await page.route("**/api/query", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ answer: "Stubbed answer from e2e." }),
    });
  });

  await page.getByRole("button", { name: "+ New chat" }).click();

  const question = "Where is Abu Simbel?";
  const conversationCreated = page.waitForResponse(
    (res) =>
      res.url().includes("/api/chat/conversations") &&
      res.request().method() === "POST" &&
      res.status() === 201
  );

  await page.getByPlaceholder("Type your message...").fill(question);
  await page.locator(".send-button").click();
  await conversationCreated;

  await expect(page.getByText("Stubbed answer from e2e.")).toBeVisible();
  // The new conversation shows up in the sidebar (titled from the question).
  await expect(
    page.locator(".conversation-item", { hasText: question })
  ).toBeVisible();
});

test("the Knowledge Base section lists documents and logout works", async ({
  page,
  request,
}) => {
  const email = uniqueEmail();
  await signupViaApi(request, email);
  await loginViaForm(page, email);

  await expect(
    page.getByRole("heading", { name: "Knowledge Base" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Document Management" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Uploaded Documents (Not Indexed)" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Indexed Documents" })
  ).toBeVisible();
  // model-server/data/egyptian_history.pdf is committed to the repo, so the
  // list always contains at least this unindexed document.
  await expect(
    page.getByText("egyptian_history.pdf")
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Index Document" })
  ).toBeVisible();

  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: /sign in/i })
  ).toBeVisible();
});
