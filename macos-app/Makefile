.PHONY: build sign dmg all clean

build:
	@bash scripts/build.sh

sign:
	@bash scripts/sign-and-notarize.sh

dmg:
	@bash scripts/create-dmg.sh

all: build sign dmg

clean:
	@echo "Cleaning build output (preserving node cache)..."
	@rm -rf "build/LucidLink MCP.app"
	@rm -rf build/LucidLinkMCP
	@rm -rf build/api
	@rm -rf build/node
	@rm -rf build/node_modules_prod
	@rm -rf build/dmg-staging
	@rm -f build/LucidLink-MCP.dmg
	@rm -f build/LucidLinkMCP.zip
	@echo "Done. Run 'make clean-all' to also remove cached downloads."

clean-all: clean
	@rm -rf build/
