import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { App } from "./App";

test("renders heading", () => {
  render(<App />);
  expect(screen.getByText(/Sapience Portal/i)).toBeInTheDocument();
});
