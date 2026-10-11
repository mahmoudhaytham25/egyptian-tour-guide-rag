import { render, screen } from '@testing-library/react';
import App from './App';
import { makeJwt, futureExp } from './test/helpers';

// The Chat page pulls in the whole chat + documents stack; the routing
// assertions only need to know whether the guarded page rendered.
vi.mock('./pages/Chat', () => ({
  default: () => <div>Chat Page</div>,
}));

const renderAt = (path) => {
  window.history.pushState({}, '', path);
  return render(<App />);
};

afterEach(() => {
  window.history.pushState({}, '', '/');
});

test('renders the sign-in page by default', () => {
  render(<App />);
  const heading = screen.getByRole('heading', { name: /sign in/i });
  expect(heading).toBeInTheDocument();
});

test('renders the registration form at /register', () => {
  renderAt('/register');
  expect(screen.getByPlaceholderText('Confirm Password')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Register' })).toBeInTheDocument();
});

test('redirects /chat to sign-in when there is no session', () => {
  renderAt('/chat');
  expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
});

test('redirects the legacy /home route through the auth guard', () => {
  renderAt('/home');
  expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
});

test('renders the chat page at /chat with a valid token', async () => {
  localStorage.setItem('authToken', makeJwt({ id: 'u1', exp: futureExp() }));
  renderAt('/chat');
  // Chat is React.lazy'd — the mocked module still resolves async.
  expect(await screen.findByText('Chat Page')).toBeInTheDocument();
});

test('redirects /home to /chat for an authenticated user', async () => {
  localStorage.setItem('authToken', makeJwt({ id: 'u1', exp: futureExp() }));
  renderAt('/home');
  expect(await screen.findByText('Chat Page')).toBeInTheDocument();
});

test('sends unknown paths back to sign-in', () => {
  renderAt('/no-such-route');
  expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
});
