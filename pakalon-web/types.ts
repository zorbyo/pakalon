export enum View {
    LANDING = 'landing',
    GITHUB_LOGIN = 'github_login',
    DASHBOARD = 'dashboard',
    BILLING = 'billing',
    PROFILE = 'profile',
    DOCS = 'docs',
    SUPPORT = 'support',
    PRICING = 'pricing',
    VERIFY = 'verify',
}

export interface SessionRecord {
    id: string
    prompt: string
    lines: number
    tokens: number
    date: string
}

export interface NavItem {
    label: string
    icon: string
    href: string
}
