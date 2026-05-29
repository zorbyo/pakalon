# Quick Reference: .env File Protection

## TL;DR

- **YOLO Mode**: `.env` files are automatically blocked from being read
- **Normal Mode**: You'll be asked for permission before `.env` files are read

## Quick Examples

### [OK] Safe in YOLO Mode
```bash
pakalon /pakalon "add a new feature" --mode yolo
# Regular files can be read
# .env files are protected
```

### [LOCK] Requires Permission in Normal Mode
```bash
pakalon
> "What's my database URL?"
# Permission dialog appears for .env
# You must approve or deny
```

## Protected Files

- `.env`
- `.env.local`
- `.env.production`
- `.env.development`
- `.env.staging`
- `.env.test`

## When to Use Each Mode

| Scenario | Recommended Mode | Why |
|----------|------------------|-----|
| Automated builds | YOLO | Safe - secrets protected |
| Code review | YOLO | Safe - no secret access needed |
| Debugging config | Normal | Need to check environment variables |
| Setting up project | Normal | May need to verify .env contents |
| CI/CD pipeline | YOLO | Prevents accidental secret exposure |

## Error Messages

### YOLO Mode
```
[X] Reading sensitive files (.env, .env.local) is not allowed 
   in YOLO/auto-accept mode for security reasons.
```

**Solution**: Switch to normal mode if you need to access .env

### Permission Denied
```
[X] Read declined by user.
```

**Solution**: You chose to deny access - this is working as intended

## Override (Not Recommended)

If you absolutely need to allow .env reads in a specific project, create `.pakalon/settings.local.json`:

```json
{
  "permissionRules": [
    {
      "tool": "readFile",
      "pattern": ".env.example",
      "action": "allow",
      "description": "Example file is safe"
    }
  ]
}
```

[!] **Warning**: Only do this for non-sensitive example files!

## More Information

See [SENSITIVE-FILE-PERMISSIONS.md](./SENSITIVE-FILE-PERMISSIONS.md) for complete documentation.
