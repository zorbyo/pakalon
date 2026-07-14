import { createSimpleContext } from "@pakalon-ai/ui/context"
import { createStore } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"

export interface UserInfo {
  user_id: string
  display_name: string
  github_login: string
  plan: string
  trial_days_remaining?: number
  billing_days_remaining?: number
}

export interface AuthState {
  isAuthenticated: boolean
  isLoading: boolean
  user: UserInfo | null
  device_id: string | null
  code: string | null
  token: string | null
  verification_url: string | null
}

export const { use: useAuth, provider: AuthProvider } = createSimpleContext({
  name: "Auth",
  init: () => {
    const [store, setStore, _, ready] = persisted(
      Persist.global("auth", ["auth.v1"]),
      createStore<AuthState>({
        isAuthenticated: false,
        isLoading: false,
        user: null,
        device_id: null,
        code: null,
        token: null,
        verification_url: null,
      }),
    )

    const setLoading = (loading: boolean) => setStore("isLoading", loading)
    
    const setAuthData = (data: Partial<AuthState>) => {
      setStore(data)
    }

    const login = async (serverUrl: string) => {
      setLoading(true)
      try {
        const response = await fetch(`${serverUrl}/auth/devices`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ device_id: null, machine_id: null }),
        })

        if (!response.ok) {
          throw new Error("Failed to create device code")
        }

        const data = await response.json()
        
        setStore({
          device_id: data.device_id,
          code: data.code,
          verification_url: data.verification_url,
          isLoading: false,
        })

        return data
      } catch (error) {
        setLoading(false)
        throw error
      }
    }

    const pollToken = async (serverUrl: string, deviceId: string) => {
      try {
        const response = await fetch(`${serverUrl}/auth/devices/${deviceId}/token`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        })

        if (response.status === 202) {
          return { status: "pending" }
        }

        if (response.status === 410) {
          throw new Error("Device code expired")
        }

        if (!response.ok) {
          throw new Error("Failed to poll token")
        }

        const data = await response.json()
        
        if (data.status === "approved" && data.access_token) {
          setStore({
            isAuthenticated: true,
            token: data.access_token,
            user: {
              user_id: data.user_id,
              display_name: data.display_name,
              github_login: data.github_login,
              plan: data.plan,
              trial_days_remaining: data.trial_days_remaining,
              billing_days_remaining: data.billing_days_remaining,
            },
            isLoading: false,
          })
        }

        return data
      } catch (error) {
        throw error
      }
    }

    const logout = () => {
      setStore({
        isAuthenticated: false,
        user: null,
        device_id: null,
        code: null,
        token: null,
        verification_url: null,
      })
    }

    return {
      ready,
      store,
      setAuthData,
      login,
      pollToken,
      logout,
      get isAuthenticated() {
        return store.isAuthenticated
      },
      get user() {
        return store.user
      },
      get token() {
        return store.token
      },
    }
  },
})
