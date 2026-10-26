install: package.json
	npm install

.PHONY: develop
develop:
	npm run dev

.PHONY: test
test: install
	npm test
	npm run typecheck
