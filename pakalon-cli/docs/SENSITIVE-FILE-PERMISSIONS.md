# Sensitive File Permission System

## Overview

The Pakalon CLI includes a security feature that protects sensitive files (like `.env` files) from being read without explicit user permission. This feature works differently depending on the permission mode you're using.

## Sensitive File Detection

The following files are automatically detected as sensitive:
- `.env`
- `.env.local`
- `.env.production`
- `.env.development`
- `.env.staging`
- `.env.test`

## Permission Modes

### Human-in-Loop Mode (Normal)

When running in **normal mode** (human-in-loop), the application will:
1. Detect when the AI agent attempts to read a sensitive file
2. Display a permission dialog with:
   - The file path being accessed
   - A warning that the file may contain sensitive information (API keys, passwords, secrets)
   - Risk level marked as "HIGH"
3. Wait for explicit user approval before reading the file
4. Block the read operation if the user denies permission

**Example:**
```bash
pakalon
# AI attempts to read .env file
# → Permission dialog appears
# → User must approve or deny
```

### YOLO Mode (Auto-Accept)

When running in **YOLO/auto-accept mode**, the application will:
1. Automatically **block** all attempts to read sensitive files
2. Return an error message explaining that sensitive files cannot be read in YOLO mode
3. Suggest switching to normal mode if access is needed

**Example:**
```bash
pakalon /pakalon "build a todo app" --mode yolo
# AI attempts to read .env file
# → Automatically blocked with error message
# → "Reading sensitive files (.env, .env.local) is not allowed in YOLO/auto-accept mode for security reasons."
```

## Why This Matters

### Security Benefits

1. **Prevents Accidental Exposure**: In YOLO mode, where all actions are auto-approved, sensitive files are protected from being accidentally read and potentially exposed.

2. **Explicit Consent**: In normal mode, users must explicitly approve reading sensitive files, ensuring they're aware when credentials might be accessed.

3. **Risk Awareness**: The system marks sensitive file reads as "HIGH" risk, making users aware of the potential security implications.

### Use Cases

**Development Workflow:**
```bash
# Safe for automated workflows - sensitive files are protected
pakalon /pakalon "add a new API endpoint" --mode yolo

# When you need to work with environment variables
pakalon  # Normal mode
# AI: "I need to check your .env file for the API key"
# → Permission dialog appears
# → You review and approve
```

**CI/CD Integration:**
```bash
# In CI/CD pipelines, YOLO mode won't accidentally expose secrets
pakalon /pakalon "run tests" --mode yolo
# .env files are automatically protected
```

## Configuration

### Project-Level Settings

You can configure permission rules in `.pakalon/settings.json` or `.pakalon/settings.local.json`:

```json
{
  "permissionRules": [
    {
      "tool": "readFile",
      "pattern": ".env*",
      "action": "ask",
      "description": "Always ask before reading .env files"
    }
  ],
  "defaultPermissionAction": "ask"
}
```

### Available Actions

- `"ask"` - Always prompt the user (default for sensitive files)
- `"allow"` - Auto-approve (not recommended for sensitive files)
- `"deny"` - Always block

## Implementation Details

### Risk Level Classification

The permission system classifies file read operations based on risk:

- **LOW**: Regular files (code, documentation, etc.)
- **MEDIUM**: Configuration files
- **HIGH**: Sensitive files (.env, .pem, .key, etc.)
- **CRITICAL**: Destructive operations (delete, etc.)

### Code Location

The implementation is split across:

1. **`src/ai/tools.ts`**: `readFileTool` with sensitive file detection
2. **`src/ai/permission-gate.ts`**: Risk inference and permission management
3. **`src/utils/permission-mode-persist.ts`**: Permission mode persistence

## Best Practices

1. **Use Normal Mode for Development**: When working with environment variables or sensitive configuration, use normal mode to maintain control.

2. **Use YOLO Mode for Safe Operations**: For automated tasks that don't require access to sensitive files, YOLO mode is safe and efficient.

3. **Review Permission Requests**: Always review what files the AI is requesting to read, especially in normal mode.

4. **Keep Secrets Out of Code**: Even with these protections, follow best practices:
   - Use `.env` files for secrets
   - Add `.env` to `.gitignore`
   - Use secret management services in production

## Troubleshooting

### "Reading sensitive files is not allowed in YOLO mode"

**Solution**: Switch to normal mode if you need the AI to access environment variables:
```bash
pakalon  # Start in normal mode
```

### Permission Dialog Not Appearing

**Check**:
1. Verify you're in normal mode (not YOLO/auto-accept)
2. Check `.pakalon/settings.json` for permission rules that might auto-allow

### Want to Auto-Allow Specific Files

**Not Recommended**, but if needed:
```json
{
  "permissionRules": [
    {
      "tool": "readFile",
      "pattern": ".env.example",
      "action": "allow",
      "description": "Example file is safe to read"
    }
  ]
}
```

## Future Enhancements

Planned improvements:
- [ ] Configurable sensitive file patterns
- [ ] Audit log for sensitive file access
- [ ] Integration with secret scanning tools
- [ ] Encrypted storage for sensitive file contents in memory
