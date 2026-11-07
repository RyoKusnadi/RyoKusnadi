.PHONY: all contributions writings trophies connect-badges

# Regenerate every README section.
all: contributions writings trophies

# Needs a GitHub token; falls back to the gh CLI's.
contributions:
	GITHUB_TOKEN=$${GITHUB_TOKEN:-$$(gh auth token)} node scripts/generate-contributions.mjs

writings:
	node scripts/generate-writings.mjs

# Re-split trophy.svg (rendered by the Trophy workflow) into animated cards.
trophies:
	node scripts/enhance-trophies.mjs

# Animated "Connect With Me" buttons; only needed when they change.
connect-badges:
	node scripts/generate-connect-badges.mjs
