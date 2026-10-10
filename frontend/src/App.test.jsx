import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the sign-in page by default', () => {
  render(<App />);
  const heading = screen.getByRole('heading', { name: /sign in/i });
  expect(heading).toBeInTheDocument();
});
