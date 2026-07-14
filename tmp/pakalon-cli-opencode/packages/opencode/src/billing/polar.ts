import { Log } from "../util/log"

const log = Log.create({ service: "billing:polar" })

export interface PolarConfig {
  apiKey: string
  baseUrl: string
  organizationId: string
}

export interface PolarCustomer {
  id: string
  email: string
  name: string
  plan: "free" | "pro"
  balance: number
}

export interface PolarInvoice {
  id: string
  customerId: string
  amount: number
  currency: string
  status: "pending" | "paid" | "overdue"
  periodStart: number
  periodEnd: number
  dueDate: number
}

const DEFAULT_CONFIG: PolarConfig = {
  apiKey: process.env.POLAR_API_KEY ?? "",
  baseUrl: "https://api.polar.sh/v1",
  organizationId: process.env.POLAR_ORG_ID ?? "",
}

export namespace Polar {
  let config = { ...DEFAULT_CONFIG }

  export function configure(cfg: Partial<PolarConfig>): void {
    config = { ...config, ...cfg }
    log.info("configured polar", { baseUrl: config.baseUrl })
  }

  export async function getCustomer(email: string): Promise<PolarCustomer | undefined> {
    log.info("fetching customer", { email })
    return undefined
  }

  export async function createCustomer(email: string, name: string): Promise<PolarCustomer> {
    const customer: PolarCustomer = {
      id: `cust-${Date.now()}`,
      email,
      name,
      plan: "free",
      balance: 0,
    }
    log.info("created customer", { id: customer.id, email })
    return customer
  }

  export async function upgradeToPro(customerId: string): Promise<boolean> {
    log.info("upgrading to pro", { customerId, deposit: "$2.00" })
    return true
  }

  export async function createInvoice(
    customerId: string,
    amount: number,
    periodStart: number,
    periodEnd: number,
  ): Promise<PolarInvoice> {
    const invoice: PolarInvoice = {
      id: `inv-${Date.now()}`,
      customerId,
      amount,
      currency: "usd",
      status: "pending",
      periodStart,
      periodEnd,
      dueDate: periodEnd + 7 * 24 * 60 * 60 * 1000,
    }
    log.info("created invoice", { id: invoice.id, amount })
    return invoice
  }

  export async function checkCredits(customerId: string): Promise<number> {
    log.info("checking credits", { customerId })
    return 100
  }

  export function isActive(config: PolarConfig = DEFAULT_CONFIG): boolean {
    return config.apiKey.length > 0
  }
}
