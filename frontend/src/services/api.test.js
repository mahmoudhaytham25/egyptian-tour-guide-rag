import axios from "axios";
import api from "./api";

// api.js calls axios.create(...) at module load and registers interceptors on
// the returned instance — the hoisted mock lets the tests drive that instance
// directly and capture the interceptor callbacks.
const { axiosInstance, createCalls } = vi.hoisted(() => ({
  axiosInstance: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  },
  // The mock factory yields a different `create` spy per importer, so api.js's
  // call isn't visible on the test's own axios.create — record the config in
  // shared hoisted state instead.
  createCalls: [],
}));

vi.mock("axios", () => ({
  default: {
    create: vi.fn((config) => {
      createCalls.push(config);
      return axiosInstance;
    }),
  },
}));

// Interceptor callbacks were captured by the mock when api.js loaded.
const requestInterceptor =
  axiosInstance.interceptors.request.use.mock.calls[0][0];
const responseSuccessInterceptor =
  axiosInstance.interceptors.response.use.mock.calls[0][0];
const responseErrorInterceptor =
  axiosInstance.interceptors.response.use.mock.calls[0][1];

const makeJwt = (payload) => {
  const segment = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${segment}.signature`;
};

const futureExp = () => Math.floor(Date.now() / 1000) + 3600;
const pastExp = () => Math.floor(Date.now() / 1000) - 3600;

// jsdom's window.location is non-configurable, so spying on `assign` fails —
// stub the whole location object instead (vitest's global is configurable).
const locationStub = { assign: vi.fn(), pathname: "/" };

describe("api service", () => {
  beforeEach(() => {
    localStorage.clear();
    // Don't clear interceptors.use — its call history is the only record of
    // the handlers registered at module load.
    axiosInstance.get.mockReset();
    axiosInstance.post.mockReset();
    axiosInstance.delete.mockReset();
    locationStub.assign.mockReset();
    locationStub.pathname = "/";
    vi.stubGlobal("location", locationStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("axios instance", () => {
    it("is created with the default API base URL and JSON headers", () => {
      expect(createCalls[0]).toEqual(
        expect.objectContaining({
          baseURL: "http://localhost:3001/api",
          timeout: 130000,
          headers: { "Content-Type": "application/json" },
        })
      );
    });
  });

  describe("token storage", () => {
    it("setAuthToken stores the token under the authToken key", () => {
      api.setAuthToken("tok-1");
      expect(localStorage.getItem("authToken")).toBe("tok-1");
    });

    it("setAuthToken removes the token when called with a falsy value", () => {
      localStorage.setItem("authToken", "tok-1");
      api.setAuthToken(null);
      expect(localStorage.getItem("authToken")).toBeNull();
      api.setAuthToken("tok-2");
      api.setAuthToken(undefined);
      expect(localStorage.getItem("authToken")).toBeNull();
    });

    it("getAuthToken returns the stored token or null", () => {
      expect(api.getAuthToken()).toBeNull();
      localStorage.setItem("authToken", "tok-3");
      expect(api.getAuthToken()).toBe("tok-3");
    });
  });

  describe("login / signup / logout", () => {
    it("login posts credentials and stores a `token` response", async () => {
      axiosInstance.post.mockResolvedValue({ data: { token: "jwt-1" } });

      const data = await api.login({ email: "a@b.c", password: "secret123" });

      expect(axiosInstance.post).toHaveBeenCalledWith("/auth/login", {
        email: "a@b.c",
        password: "secret123",
      });
      expect(localStorage.getItem("authToken")).toBe("jwt-1");
      expect(data).toEqual({ token: "jwt-1" });
    });

    it("login stores `accessToken` when `token` is absent", async () => {
      axiosInstance.post.mockResolvedValue({ data: { accessToken: "jwt-2" } });

      await api.login({ email: "a@b.c", password: "secret123" });

      expect(localStorage.getItem("authToken")).toBe("jwt-2");
    });

    it("login leaves storage untouched when the response has no token", async () => {
      axiosInstance.post.mockResolvedValue({ data: { message: "ok" } });

      await api.login({ email: "a@b.c", password: "secret123" });

      expect(localStorage.getItem("authToken")).toBeNull();
    });

    it("signup posts the payload and returns data without storing a token", async () => {
      axiosInstance.post.mockResolvedValue({
        data: { message: "Signup successful.", token: "jwt-3" },
      });

      const data = await api.signup({ email: "a@b.c", password: "secret123" });

      expect(axiosInstance.post).toHaveBeenCalledWith("/auth/signup", {
        email: "a@b.c",
        password: "secret123",
      });
      expect(data.token).toBe("jwt-3");
      // Signup deliberately doesn't persist — the caller decides via setAuthToken.
      expect(localStorage.getItem("authToken")).toBeNull();
    });

    it("logout clears the token and all legacy chat keys", () => {
      localStorage.setItem("authToken", "tok");
      localStorage.setItem("conversationId_user-1", "c1");
      localStorage.setItem("conversationId", "legacy");
      localStorage.setItem("currentUserId", "u1");
      localStorage.setItem("globalState", "x");
      localStorage.setItem("unrelated", "keep-me");

      api.logout();

      expect(localStorage.getItem("authToken")).toBeNull();
      expect(localStorage.getItem("conversationId_user-1")).toBeNull();
      expect(localStorage.getItem("conversationId")).toBeNull();
      expect(localStorage.getItem("currentUserId")).toBeNull();
      expect(localStorage.getItem("globalState")).toBeNull();
      expect(localStorage.getItem("unrelated")).toBe("keep-me");
    });
  });

  describe("isAuthenticated", () => {
    it("returns false when there is no token", () => {
      expect(api.isAuthenticated()).toBe(false);
    });

    it("returns false for a malformed token", () => {
      localStorage.setItem("authToken", "not-a-jwt");
      expect(api.isAuthenticated()).toBe(false);
      localStorage.setItem("authToken", "header.@@not-base64@@.sig");
      expect(api.isAuthenticated()).toBe(false);
    });

    it("returns false for an expired token", () => {
      localStorage.setItem("authToken", makeJwt({ id: "u1", exp: pastExp() }));
      expect(api.isAuthenticated()).toBe(false);
    });

    it("returns true for a token with a future exp", () => {
      localStorage.setItem("authToken", makeJwt({ id: "u1", exp: futureExp() }));
      expect(api.isAuthenticated()).toBe(true);
    });

    it("treats tokens without an exp claim as valid", () => {
      localStorage.setItem("authToken", makeJwt({ id: "u1" }));
      expect(api.isAuthenticated()).toBe(true);
    });
  });

  describe("getUserId", () => {
    it("returns null when there is no token", () => {
      expect(api.getUserId()).toBeNull();
    });

    it("reads the id claim", () => {
      localStorage.setItem("authToken", makeJwt({ id: "user-42" }));
      expect(api.getUserId()).toBe("user-42");
    });

    it("falls back through userId, sub, and user_id claims", () => {
      localStorage.setItem("authToken", makeJwt({ userId: "via-userId" }));
      expect(api.getUserId()).toBe("via-userId");
      localStorage.setItem("authToken", makeJwt({ sub: "via-sub" }));
      expect(api.getUserId()).toBe("via-sub");
      localStorage.setItem("authToken", makeJwt({ user_id: "via-user_id" }));
      expect(api.getUserId()).toBe("via-user_id");
    });

    it("returns null when the payload has no user claim", () => {
      localStorage.setItem("authToken", makeJwt({ role: "admin" }));
      expect(api.getUserId()).toBeNull();
    });
  });

  describe("conversation endpoints", () => {
    it("getConversations GETs /chat/conversations", async () => {
      axiosInstance.get.mockResolvedValue({ data: [{ _id: "c1" }] });
      await expect(api.getConversations()).resolves.toEqual([{ _id: "c1" }]);
      expect(axiosInstance.get).toHaveBeenCalledWith("/chat/conversations");
    });

    it("getConversation GETs the conversation by id", async () => {
      axiosInstance.get.mockResolvedValue({
        data: { conversation: { _id: "c1" }, messages: [] },
      });
      await api.getConversation("c1");
      expect(axiosInstance.get).toHaveBeenCalledWith("/chat/conversations/c1");
    });

    it("createConversation POSTs the body to /chat/conversations", async () => {
      axiosInstance.post.mockResolvedValue({ data: { _id: "c2" } });
      const data = await api.createConversation({ title: "Hi" });
      expect(axiosInstance.post).toHaveBeenCalledWith("/chat/conversations", {
        title: "Hi",
      });
      expect(data).toEqual({ _id: "c2" });
    });

    it("addMessageToConversation POSTs to the messages sub-resource", async () => {
      axiosInstance.post.mockResolvedValue({ data: { _id: "m1" } });
      await api.addMessageToConversation("c1", {
        role: "user",
        content: "hi",
      });
      expect(axiosInstance.post).toHaveBeenCalledWith(
        "/chat/conversations/c1/messages",
        { role: "user", content: "hi" }
      );
    });

    it("deleteConversation DELETEs the conversation resource", async () => {
      axiosInstance.delete.mockResolvedValue({ data: { message: "deleted" } });
      await api.deleteConversation("c1");
      expect(axiosInstance.delete).toHaveBeenCalledWith(
        "/chat/conversations/c1"
      );
    });
  });

  describe("documents and query endpoints", () => {
    it("uploadDocument POSTs FormData with the pdf field", async () => {
      axiosInstance.post.mockResolvedValue({ data: { filename: "doc.pdf" } });
      const file = new File(["%PDF"], "doc.pdf", { type: "application/pdf" });

      const data = await api.uploadDocument(file);

      expect(axiosInstance.post).toHaveBeenCalledTimes(1);
      const [url, body, config] = axiosInstance.post.mock.calls[0];
      expect(url).toBe("/upload");
      expect(body).toBeInstanceOf(FormData);
      expect(body.get("pdf")).toBe(file);
      expect(config.headers["Content-Type"]).toBe("multipart/form-data");
      expect(data).toEqual({ filename: "doc.pdf" });
    });

    it("indexDocument POSTs the filename to /index", async () => {
      axiosInstance.post.mockResolvedValue({ data: { success: true } });
      await api.indexDocument("doc.pdf");
      expect(axiosInstance.post).toHaveBeenCalledWith("/index", {
        filename: "doc.pdf",
      });
    });

    it("getIndexingStatus GETs /indexing-status", async () => {
      axiosInstance.get.mockResolvedValue({ data: { status: {} } });
      await api.getIndexingStatus();
      expect(axiosInstance.get).toHaveBeenCalledWith("/indexing-status");
    });

    it("askQuestion wraps a plain string into a query body", async () => {
      axiosInstance.post.mockResolvedValue({ data: { answer: "42" } });
      await api.askQuestion("what is this?");
      expect(axiosInstance.post).toHaveBeenCalledWith("/query", {
        query: "what is this?",
      });
    });

    it("askQuestion passes a body object through unchanged", async () => {
      axiosInstance.post.mockResolvedValue({ data: { answer: "42" } });
      await api.askQuestion({ query: "q", conversationId: "c1" });
      expect(axiosInstance.post).toHaveBeenCalledWith("/query", {
        query: "q",
        conversationId: "c1",
      });
    });

    it("getDocuments GETs /documents", async () => {
      axiosInstance.get.mockResolvedValue({ data: { documents: [] } });
      await expect(api.getDocuments()).resolves.toEqual({ documents: [] });
      expect(axiosInstance.get).toHaveBeenCalledWith("/documents");
    });
  });

  describe("interceptors", () => {
    it("attaches the Bearer token to outgoing requests", () => {
      localStorage.setItem("authToken", "tok-9");
      const config = requestInterceptor({ headers: {} });
      expect(config.headers.Authorization).toBe("Bearer tok-9");
    });

    it("omits the Authorization header when there is no token", () => {
      const config = requestInterceptor({ headers: {} });
      expect(config.headers.Authorization).toBeUndefined();
    });

    it("passes successful responses through unchanged", () => {
      const response = { status: 200, data: { ok: true } };
      expect(responseSuccessInterceptor(response)).toBe(response);
    });

    it("clears auth data and redirects to / on a 401", async () => {
      locationStub.pathname = "/chat";
      localStorage.setItem("authToken", "expired");
      localStorage.setItem("currentUserId", "u1");
      const error = { response: { status: 401 } };

      await expect(responseErrorInterceptor(error)).rejects.toBe(error);

      expect(localStorage.getItem("authToken")).toBeNull();
      expect(localStorage.getItem("currentUserId")).toBeNull();
      expect(locationStub.assign).toHaveBeenCalledWith("/");
    });

    it("clears auth but does not redirect on a 401 while already on /", async () => {
      locationStub.pathname = "/";
      localStorage.setItem("authToken", "expired");
      const error = { response: { status: 401 } };

      await expect(responseErrorInterceptor(error)).rejects.toBe(error);

      expect(localStorage.getItem("authToken")).toBeNull();
      expect(locationStub.assign).not.toHaveBeenCalled();
    });

    it("rethrows non-401 errors without clearing auth or redirecting", async () => {
      locationStub.pathname = "/chat";
      localStorage.setItem("authToken", "still-valid");
      const error = { response: { status: 500 } };

      await expect(responseErrorInterceptor(error)).rejects.toBe(error);

      expect(localStorage.getItem("authToken")).toBe("still-valid");
      expect(locationStub.assign).not.toHaveBeenCalled();
    });
  });
});
