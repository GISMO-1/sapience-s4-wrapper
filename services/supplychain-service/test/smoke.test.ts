import Fastify from "fastify";
import request from "supertest";
import { afterAll, beforeAll, expect, test } from "vitest";
import { registerHealthRoutes } from "../src/health";

const app = Fastify();

beforeAll(async () => {
  await registerHealthRoutes(app);
});

afterAll(async () => {
  await app.close();
});

test("GET /health", async () => {
  const response = await request(app.server).get("/health");
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: "ok" });
});
