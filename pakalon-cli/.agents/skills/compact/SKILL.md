---
name: compact
description: Compress markdown files to reduce token usage by ~46% while preserving structure
origin: Pakalon
---

# Terse-Compress: Input File Compression

Compresses natural language markdown files to reduce token usage by ~46% while preserving all technical content and structure.

## When to Activate

- User says "compress file" or "/terse:compress"
- User asks to "optimize memory files"
- User says "reduce token count" for a document
- User says "compact this" referring to a .md file

## Compression Rules

### REMOVE from prose:
- Articles: a, an, the
- Filler: just, really, basically, actually, simply, essentially, generally
- Pleasantries: "sure", "certainly", "of course", "happy to", "I'd recommend"
- Hedging: "it might be worth", "you could consider", "it would be good to"
- Redundant: "in order to" → "to", "make sure to" → "ensure"
- Connective fluff: "however", "furthermore", "additionally"

### PRESERVE EXACTLY (never modify):
- Code blocks (fenced ``` and indented)
- Inline code (`backtick content`)
- URLs and links
- File paths (`/src/components/...`, `./config.yaml`)
- Commands (`npm install`, `git commit`)
- Technical terms (library names, API names, protocols)
- Proper nouns (project names, people, companies)
- Dates, version numbers, numeric values
- Environment variables (`$HOME`, `NODE_ENV`)
- YAML frontmatter headers

### PRESERVE Structure:
- All markdown headings (keep exact text, compress body)
- Bullet point hierarchy
- Numbered lists
- Tables (compress cell text, keep structure)

## Process

1. Read the file content
2. Extract and protect all code blocks, URLs, paths
3. Compress only natural language prose
4. Restore protected content
5. Return compressed result

## Example

**Original:**
> You should always make sure to run the test suite before pushing any changes to the main branch. This is important because it helps catch bugs early and prevents broken builds from being deployed to production.

**Compressed:**
> Run tests before push to main. Catch bugs early, prevent broken prod deploys.

## File Support

### Compressible:
- .md, .txt, .markdown, .rst files

### Skip (do not compress):
- Source code: .py, .js, .ts, .tsx, .jsx, .go, .rs, .java, etc.
- Config files: .json, .yaml, .yml, .toml, .env
- Markup: .html, .xml, .css, .scss
- Shell: .sh, .bash, .zsh, .dockerfile
- Database: .sql

### Auto-detect:
Extensionless files are classified by content patterns:
- JSON parse success → config
- YAML key-value patterns → config
- >40% code lines → code
- Otherwise → natural language

## Validation

After compression, verify:
1. Heading count matches original
2. Code blocks identical to original
3. URLs preserved exactly
4. File paths preserved
5. Bullet structure >85% preserved

## Usage

```
/terse:compress <filepath>
terse:compress .pakalon/plan.md
terse:compress CLAUDE.md AGENTS.md
```

## Output Format

When compression is complete, report:
- Original size (chars)
- Compressed size (chars)
- Token savings estimate (~46% typical)
- Any warnings about structure changes