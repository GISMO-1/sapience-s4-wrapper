.PHONY: up down logs test build demo

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
