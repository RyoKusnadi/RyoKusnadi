.PHONY: all contributions writings

# Regenerate every README section.
all: contributions writings

# Needs a GitHub token; falls back to the gh CLI's.
contributions:
	GITHUB_TOKEN=$${GITHUB_TOKEN:-$$(gh auth token)} node scripts/generate-contributions.mjs

writings:
	node scripts/generate-writings.mjs
