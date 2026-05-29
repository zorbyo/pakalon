# Pakalon Rules Index

This file lists all available rules in the Pakalon integrations.

## Common Rules (Language-Agnostic)

These rules apply to all projects regardless of language:

- `common/coding-style.md` - Immutability, file organization, error handling
- `common/git-workflow.md` - Commit format, PR process
- `common/testing.md` - TDD, 80% coverage requirement
- `common/performance.md` - Model selection, context management
- `common/patterns.md` - Design patterns, skeleton projects
- `common/hooks.md` - Hook architecture, TodoWrite
- `common/agents.md` - When to delegate to subagents
- `common/security.md` - Mandatory security checks
- `common/development-workflow.md` - Feature implementation workflow

## Language-Specific Rules

### TypeScript/JavaScript
- `typescript/coding-style.md` - TypeScript-specific patterns
- `typescript/testing.md` - TypeScript testing patterns
- `typescript/performance.md` - TypeScript performance
- `typescript/security.md` - TypeScript security

### Python
- `python/coding-style.md` - Python-specific patterns
- `python/testing.md` - Python testing with pytest
- `python/performance.md` - Python performance
- `python/security.md` - Python security

### Golang
- `golang/coding-style.md` - Go-specific patterns
- `golang/testing.md` - Go testing patterns
- `golang/performance.md` - Go performance
- `golang/security.md` - Go security

### Swift
- `swift/coding-style.md` - Swift-specific patterns
- `swift/testing.md` - Swift testing patterns
- `swift/performance.md` - Swift performance
- `swift/security.md` - Swift security

### PHP
- `php/coding-style.md` - PHP-specific patterns
- `php/testing.md` - PHP testing patterns
- `php/performance.md` - PHP performance
- `php/security.md` - PHP security

### Java
- `java/coding-style.md` - Java-specific patterns
- `java/testing.md` - Java testing patterns
- `java/performance.md` - Java performance
- `java/security.md` - Java security

### Kotlin
- `kotlin/coding-style.md` - Kotlin-specific patterns
- `kotlin/testing.md` - Kotlin testing patterns
- `kotlin/performance.md` - Kotlin performance
- `kotlin/security.md` - Kotlin security

### C++
- `cpp/coding-style.md` - C++-specific patterns
- `cpp/testing.md` - C++ testing patterns
- `cpp/performance.md` - C++ performance
- `cpp/security.md` - C++ security

### Perl
- `perl/coding-style.md` - Perl-specific patterns
- `perl/testing.md` - Perl testing patterns
- `perl/performance.md` - Perl performance
- `perl/security.md` - Perl security

## Installation

Copy the rules to your Pakalon configuration:

```bash
# Copy common rules
cp -r integrations/rules/common/* ~/.pakalon/rules/

# Copy language-specific rules (choose your stack)
cp -r integrations/rules/typescript/* ~/.pakalon/rules/
cp -r integrations/rules/python/* ~/.pakalon/rules/
cp -r integrations/rules/golang/* ~/.pakalon/rules/
```

## Total Rules: 34

## Usage

Rules are automatically loaded by Pakalon CLI. They provide guidelines for:
- Code style and organization
- Testing requirements
- Security practices
- Performance optimization
- Git workflow
