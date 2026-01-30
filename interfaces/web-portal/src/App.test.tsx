import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { App } from "./App";
import { expect, test } from "vitest";

test("renders heading", () => {
  render(<App />);
  expect(screen.getByText(/Sapience Portal/i)).toBeInTheDocument();
});
