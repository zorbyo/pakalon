import { cmd } from "./cmd"
import { UI } from "../ui"
import { Account } from "../../account"
import { Auth } from "../../auth"

interface OauthRefreshArgs {
  provider?: string
  json?: boolean
}

export const OauthRefreshCommand = cmd({
  command: "oauth-refresh [provider]",
  describe: "refresh/check OAuth-backed tokens",
  builder: (yargs) =>
    yargs
      .positional("provider", {
        type: "string",
        describe: "Optional provider ID to inspect OAuth token metadata",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Output JSON",
      }),
  handler: async (rawArgs) => {
    const args: OauthRefreshArgs = {
      provider: typeof rawArgs.provider === "string" ? rawArgs.provider : undefined,
      json: Boolean(rawArgs.json),
    }

    const providerID = args.provider?.trim()
    const now = Date.now()

    const active = Account.active()
    const activeAccountToken = active ? await Account.token(active.id) : undefined

    const result: Record<string, unknown> = {
      account: {
        active: active
          ? {
              id: active.id,
              email: active.email,
              orgID: active.active_org_id,
            }
          : null,
        tokenAvailable: Boolean(activeAccountToken),
      },
    }

    if (providerID) {
      const auth = await Auth.get(providerID)
      if (!auth) {
        result.provider = {
          id: providerID,
          found: false,
          refreshed: false,
          message: "No auth entry found for provider",
        }
      } else if (auth.type !== "oauth") {
        result.provider = {
          id: providerID,
          found: true,
          type: auth.type,
          refreshed: false,
          message: "Provider does not use OAuth tokens",
        }
      } else {
        const expired = auth.expires <= now
        let accountTokenRefreshed = false

        if (auth.accountId) {
          const token = await Account.token(auth.accountId as any)
          accountTokenRefreshed = Boolean(token)
        }

        result.provider = {
          id: providerID,
          found: true,
          type: auth.type,
          expired,
          expiresAt: auth.expires,
          refreshedViaAccountToken: accountTokenRefreshed,
        }
      }
    }

    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }

    UI.println(UI.Style.TEXT_HIGHLIGHT + "OAuth Refresh" + UI.Style.TEXT_NORMAL)
    UI.empty()

    if (!active) {
      UI.println(UI.Style.TEXT_WARNING + "No active account session." + UI.Style.TEXT_NORMAL)
      UI.println(UI.Style.TEXT_DIM + "Run `pakalon login` to authenticate first." + UI.Style.TEXT_NORMAL)
    } else if (activeAccountToken) {
      UI.println(UI.Style.TEXT_SUCCESS + "✓ Active account token is valid" + UI.Style.TEXT_NORMAL)
      UI.println(UI.Style.TEXT_DIM + `Account: ${active.email} (${active.id})` + UI.Style.TEXT_NORMAL)
    } else {
      UI.println(UI.Style.TEXT_WARNING + "Active account token is unavailable." + UI.Style.TEXT_NORMAL)
      UI.println(UI.Style.TEXT_DIM + "Re-run `pakalon login` to restore access." + UI.Style.TEXT_NORMAL)
      process.exitCode = 1
    }

    if (providerID) {
      const provider = (result.provider ?? {}) as Record<string, unknown>
      UI.empty()
      UI.println(UI.Style.TEXT_INFO + `Provider: ${providerID}` + UI.Style.TEXT_NORMAL)
      if (provider.found === false) {
        UI.println(UI.Style.TEXT_WARNING + "No auth entry found." + UI.Style.TEXT_NORMAL)
      } else if (provider.type !== "oauth") {
        UI.println(UI.Style.TEXT_DIM + `Auth type: ${String(provider.type)}` + UI.Style.TEXT_NORMAL)
      } else {
        const expired = Boolean(provider.expired)
        UI.println(`Token state: ${expired ? "expired" : "valid"}`)
        const expiresAt = provider.expiresAt as number | undefined
        if (expiresAt) {
          UI.println(`Expires at: ${new Date(expiresAt).toLocaleString()}`)
        }
      }
    }
  },
})
