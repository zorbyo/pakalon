import { Log } from "../util/log"
import { getClient } from "./client"
import type {
  BillingCheckoutRequest,
  BillingCheckoutResponse,
  BillingSubscriptionResponse,
  BillingPortalResponse,
} from "./types"

const log = Log.create({ service: "backend:billing" })

export namespace BillingBackend {
  export async function createCheckout(request: BillingCheckoutRequest): Promise<BillingCheckoutResponse> {
    const client = getClient()
    log.info("creating checkout", { priceId: request.price_id })
    const response = await client.post<BillingCheckoutResponse>("/billing/checkout", request)
    log.info("checkout created", { sessionId: response.session_id })
    return response
  }

  export async function cancelSubscription(): Promise<{ success: boolean; message: string }> {
    const client = getClient()
    log.info("cancelling subscription")
    const response = await client.delete<{ success: boolean; message: string }>("/billing/cancel")
    log.info("subscription cancelled", { success: response.success })
    return response
  }

  export async function getSubscription(): Promise<BillingSubscriptionResponse> {
    const client = getClient()
    log.info("getting subscription")
    const response = await client.get<BillingSubscriptionResponse>("/billing/subscription")
    log.info("subscription retrieved", { status: response.status, plan: response.plan })
    return response
  }

  export async function getPortalUrl(): Promise<BillingPortalResponse> {
    const client = getClient()
    log.info("getting portal URL")
    const response = await client.get<BillingPortalResponse>("/billing/portal-url")
    log.info("portal URL retrieved")
    return response
  }

  export async function openCheckout(priceId: string): Promise<void> {
    const checkout = await createCheckout({
      price_id: priceId,
      success_url: `${typeof window !== "undefined" ? window.location.origin : ""}/success`,
      cancel_url: `${typeof window !== "undefined" ? window.location.origin : ""}/cancel`,
    })
    
    if (typeof window !== "undefined" && checkout.checkout_url) {
      window.open(checkout.checkout_url, "_blank")
    }
  }

  export async function openPortal(): Promise<void> {
    const portal = await getPortalUrl()
    
    if (typeof window !== "undefined" && portal.portal_url) {
      window.open(portal.portal_url, "_blank")
    }
  }
}
