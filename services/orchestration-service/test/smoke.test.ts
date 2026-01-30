import Fastify from "fastify";
import { afterAll, beforeAll, expect, test } from "vitest";
import { registerHealthRoutes } from "../src/health";

const app = Fastify();

beforeAll(async () => {
  await registerHealthRoutes(app);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

test("GET /health", async () => {
  const response = await app.inject({ method: "GET", url: "/health" });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ status: "ok" });
});
