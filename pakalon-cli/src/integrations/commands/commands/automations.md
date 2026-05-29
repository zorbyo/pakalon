# Automations

Create and manage automation workflows that run on schedules or triggers.

## Usage

```
/automations [action] [options]
```

## Actions

| Action | Description |
|--------|-------------|
| `list` | Show all created automations |
| `create` | Create a new automation |
| `edit <name>` | Edit an existing automation |
| `delete <name>` | Delete an automation |
| `run <name>` | Run an automation immediately |
| `enable <name>` | Enable an automation |
| `disable <name>` | Disable an automation |

## Creating an Automation

When you run `/automations create`, it guides you through:

1. **Name**: Enter a name for the automation
2. **Trigger**: Choose trigger type:
   - **Cron**: Run on a schedule (e.g., every hour, daily at 9am)
   - **Webhook**: Run when a webhook is received
   - **Event**: Run on specific events (git push, PR opened, etc.)
3. **Prompt**: Describe what the automation should do
4. **Connections**: Connect required services (GitHub, Slack, etc.)
5. **Schedule**: Set the cron schedule (if cron trigger)

## Example Automation Workflows

### Check PR Issues and Notify Slack

```
Prompt: "Check for any open PR issues from my repo {owner/repo} and if found, summarize them and send to Slack channel #{channel}"
Connections: GitHub, Slack
Schedule: Every hour
```

### Daily Code Review Summary

```
Prompt: "Run a code review on the main branch and post summary to Slack"
Connections: GitHub, Slack
Schedule: Daily at 9am
```

### Monitor CI/CD and Alert

```
Prompt: "Check CI status for {repo}, if any pipeline failed, create a GitHub issue and notify in Slack"
Connections: GitHub, Slack
Schedule: Every 15 minutes
```

## Templates

Pre-built automation templates available:

| Template | Description |
|----------|-------------|
| `pr-monitor` | Monitor PRs and notify on changes |
| `ci-watchdog` | Watch CI pipelines and alert on failures |
| `daily-summary` | Post daily code summary to Slack |
| `security-scan` | Run security scan and report |
| `dependency-update` | Check for outdated dependencies |

## Listing Automations

```
/automations list
```

Shows:
- Name and description
- Trigger type and schedule
- Enabled/disabled status
- Last run time and status
- Next scheduled run

## Connecting Services

Automations can connect to:

| Service | Permissions Needed |
|---------|-------------------|
| GitHub | repo, issues, pull_requests |
| Slack | chat:write, channels:read |
| Jira | issues:read, issues:write |
| Linear | Issues API access |

## Managing Secrets

Service connections use secure credential storage:
- API tokens are encrypted at rest
- Credentials are never exposed in logs
- Can be revoked at any time

## Examples

```bash
# List all automations
/automations list

# Create a new automation
/automations create

# Edit existing automation
/automations edit my-pr-monitor

# Delete an automation
/automations delete old-automation

# Run immediately
/automations run my-automation

# Disable an automation
/automations disable my-automation
```

## Persistence

Automations are stored in:
- `.pakalon/automations/` - automation definitions
- `.pakalon/automations/runs/` - execution history

## Related Commands

- `/new` - Start a new session
- `/sessions` - View session history