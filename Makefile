.PHONY: up down logs test build demo golden golden-check

up:
	cd infra && docker compose up --build

down:
	cd infra && docker compose down -v

logs:
	cd infra && docker compose logs -f --tail=200

test:
	pnpm -r test

build:
	pnpm -r build

demo:
	@echo "Seeding demo data via API gateway (expected at http://localhost:8080)..."
	pnpm -C interfaces/api-gateway exec tsx ../../scripts/seed-demo.ts

golden:
	pnpm -C interfaces/api-gateway exec tsx ../../scripts/golden-demo.ts
	cp artifacts/golden-demo.json artifacts/golden-baseline.json

golden-check:
	pnpm -C interfaces/api-gateway exec vitest run test/golden-regression.test.ts
