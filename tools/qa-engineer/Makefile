.PHONY: build web test
build: web
	go build -o bin/qa-engineer ./cmd/qa-engineer
web:
	cd web && npm ci && npm run build
	touch internal/web/dist/.gitkeep
test:
	go test ./...
	cd web && npm test
