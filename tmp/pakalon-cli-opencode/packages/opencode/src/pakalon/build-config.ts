/**
 * Pakalon Build Configuration
 * 
 * Handles packaging and release engineering for Pakalon CLI.
 */

import { Pakalon } from "./index"

export interface BuildConfig {
  name: string
  version: string
  description: string
  entry: string
  output: string
  targets: string[]
  minify: boolean
  sourcemap: boolean
}

export interface ReleaseConfig {
  platform: "npm" | "github" | "brew"
  repository: string
  assets: string[]
  notes: string
}

export namespace PakalonBuild {
  /**
   * Get build configuration
   */
  export function getBuildConfig(): BuildConfig {
    return {
      name: "pakalon",
      version: Pakalon.VERSION,
      description: Pakalon.DESCRIPTION,
      entry: "./src/index.ts",
      output: "./dist",
      targets: ["bun-linux-x64", "bun-linux-arm64", "bun-darwin-x64", "bun-darwin-arm64", "bun-windows-x64"],
      minify: true,
      sourcemap: true,
    }
  }

  /**
   * Get release configuration
   */
  export function getReleaseConfig(): ReleaseConfig {
    return {
      platform: "github",
      repository: "pakalon/pakalon-cli",
      assets: [
        "dist/pakalon-linux-x64",
        "dist/pakalon-linux-arm64",
        "dist/pakalon-darwin-x64",
        "dist/pakalon-darwin-arm64",
        "dist/pakalon-windows-x64.exe",
      ],
      notes: `Pakalon CLI v${Pakalon.VERSION} - AI-powered 6-phase development pipeline`,
    }
  }

  /**
   * Generate package.json for npm
   */
  export function generatePackageJson(): object {
    const config = getBuildConfig()
    return {
      name: config.name,
      version: config.version,
      description: config.description,
      main: "dist/index.js",
      bin: {
        pakalon: "./bin/pakalon",
      },
      files: [
        "dist",
        "bin",
        "README.md",
        "LICENSE",
      ],
      scripts: {
        build: "bun build ./src/index.ts --outdir ./dist --target bun",
        start: "bun run ./src/index.ts",
        test: "bun test",
        prepublishOnly: "bun run build",
      },
      keywords: [
        "ai",
        "cli",
        "development",
        "pipeline",
        "automation",
        "code-generation",
      ],
      license: "MIT",
      dependencies: {
        // Core dependencies would be listed here
      },
      devDependencies: {
        // Dev dependencies would be listed here
      },
    }
  }

  /**
   * Generate README
   */
  export function generateReadme(): string {
    return `# Pakalon CLI

${Pakalon.DESCRIPTION}

## Installation

\`\`\`bash
npm install -g pakalon
\`\`\`

Or download the binary for your platform from the releases page.

## Quick Start

\`\`\`bash
# Initialize a new project
pakalon init my-project

# Start the AI pipeline
pakalon start

# Run with interactive mode
pakalon --interactive
\`\`\`

## Features

- 🚀 **6-Phase Development Pipeline**: Planning → Design → Development → Testing → Deployment → Documentation
- 🤖 **AI-Powered**: Uses Pakalon's powerful AI models
- 🎨 **Penpot Integration**: Design wireframes and sync with code
- 🔒 **Security Scanning**: Built-in security tools
- 📊 **Progress Tracking**: Visual progress display
- 🔄 **HIL/YOLO Modes**: Human-in-Loop or fully automated

## Phases

1. **Planning & Requirements** - Define your project with AI assistance
2. **Wireframe Generation** - Create design mockups
3. **Development** - Automated code generation with subagents
4. **Testing & QA** - Browser-based testing and validation
5. **Deployment** - Automated deployment pipelines
6. **Documentation** - Generate comprehensive docs

## Commands

\`\`\`bash
pakalon init     # Initialize Pakalon pipeline
pakalon status   # Show pipeline status
pakalon run      # Run current phase
pakalon pause    # Pause pipeline
pakalon resume   # Resume pipeline
\`\`\`

## License

MIT
`
  }

  /**
   * Generate installation script
   */
  export function generateInstallScript(): string {
    return `#!/bin/bash
# Pakalon CLI Installation Script

set -e

VERSION="${Pakalon.VERSION}"
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case $ARCH in
  x86_64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

case $OS in
  linux) PLATFORM="linux" ;;
  darwin) PLATFORM="darwin" ;;
  mingw*|msys*|cygwin*) PLATFORM="windows" ;;
  *) echo "Unsupported platform: $OS"; exit 1 ;;
esac

DOWNLOAD_URL="https://github.com/pakalon/pakalon-cli/releases/download/v$VERSION/pakalon-$PLATFORM-$ARCH"

if [ "$PLATFORM" = "windows" ]; then
  DOWNLOAD_URL="$DOWNLOAD_URL.exe"
fi

echo "Downloading Pakalon CLI v$VERSION for $PLATFORM-$ARCH..."
curl -L "$DOWNLOAD_URL" -o /usr/local/bin/pakalon

chmod +x /usr/local/bin/pakalon

echo "Pakalon CLI installed successfully!"
echo "Run 'pakalon --help' to get started."
`
  }
}

export default PakalonBuild
