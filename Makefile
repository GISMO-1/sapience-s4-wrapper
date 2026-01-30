.PHONY: up down logs test

up:
	cd infra && docker compose up --build

down:
	cd infra && docker compose down -v

logs:
	cd infra && docker compose logs -f --tail=200

test:
	pnpm -r test
