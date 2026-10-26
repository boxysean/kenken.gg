CFN_STACK_NAME=kenken-gg-web
CFN_PARAMETERS_FILE=kenken-gg-cfn-params.json

.PHONY: deploy-cloudformation-stack
deploy-cloudformation-stack: cfn-template.yml $(CFN_PARAMETERS_FILE)
	./deploy-cloudformation-stack.sh $(CFN_STACK_NAME) $(CFN_PARAMETERS_FILE)

.PHONY: deploy-web
deploy-web: build
	$(eval WEBSITE_BUCKET := $(shell aws cloudformation describe-stacks --stack-name kenken-gg-web | jq -r '.Stacks[0].Outputs[] | select(.OutputKey == "S3Bucket").OutputValue'))
	aws s3 sync dist/ s3://$(WEBSITE_BUCKET)/

.PHONY: build
build: install
	npm run build

.PHONY: invalidate-cloudfront-cache
invalidate-cloudfront-cache:
	$(eval DISTRIBUTION_ID := $(shell aws cloudformation describe-stacks --stack-name kenken-gg-web | jq -r '.Stacks[0].Outputs[] | select(.OutputKey == "CloudFrontDistributionId").OutputValue'))
	aws cloudfront create-invalidation --distribution-id $(DISTRIBUTION_ID) --paths "/*"

.PHONY: deploy
deploy: deploy-cloudformation-stack deploy-web invalidate-cloudfront-cache

.PHONY: undeploy
undeploy:
	aws cloudformation delete-stack --stack-name $(CFN_STACK_NAME)

.PHONY: install
install: package.json
	npm install

.PHONY: develop
develop:
	npm run dev

.PHONY: test
test: install
	npm test
	npm run typecheck
