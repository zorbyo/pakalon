import { createSignal, onCleanup, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useAuth } from "@/context/auth"
import { useServer } from "@/context/server"

export default function Login() {
  const auth = useAuth()
  const server = useServer()
  const navigate = useNavigate()
  
  const [error, setError] = createSignal<string | null>(null)
  const [polling, setPolling] = createSignal(false)
  
  let pollInterval: ReturnType<typeof setInterval> | undefined

  const startPolling = async () => {
    if (!auth.store.device_id || !server.current) return
    
    setPolling(true)
    pollInterval = setInterval(async () => {
      try {
        const result = await auth.pollToken(server.current!.http.url, auth.store.device_id!)
        
        if (result.status === "approved") {
          setPolling(false)
          if (pollInterval) clearInterval(pollInterval)
          navigate("/")
        }
      } catch (err) {
        setPolling(false)
        if (pollInterval) clearInterval(pollInterval)
        setError(err instanceof Error ? err.message : "Authentication failed")
      }
    }, 2000)
  }

  const handleLogin = async () => {
    if (!server.current) {
      setError("Server not connected")
      return
    }

    setError(null)
    try {
      await auth.login(server.current.http.url)
      startPolling()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start authentication")
    }
  }

  const openVerificationUrl = () => {
    if (auth.store.verification_url) {
      window.open(auth.store.verification_url, "_blank")
    }
  }

  onCleanup(() => {
    if (pollInterval) clearInterval(pollInterval)
  })

  return (
    <div class="flex flex-col items-center justify-center min-h-screen bg-transparent">
      <div class="w-full max-w-md p-6 bg-black/50 rounded-lg border-2" style={{ "border-color": "#E8AA41" }}>
        <div class="flex flex-col items-center mb-6">
          <svg 
            class="w-32 h-32 mb-4" 
            viewBox="0 0 350 350" 
            fill="none" 
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect width="350" height="350" fill="black"/>
            <rect x="45" y="39" width="260" height="130" fill="url(#pattern0)"/>
            <line x1="29.5" y1="39.9923" x2="29.5" y2="170.008" stroke="#E8AA41"/>
            <line x1="320.998" y1="170.5" x2="29.9983" y2="169.5" stroke="#E8AA41"/>
            <line x1="320.998" y1="41.5" x2="29.9983" y2="40.5" stroke="#E8AA41"/>
            <line x1="320.5" y1="41" x2="320.5" y2="170" stroke="#E8AA41"/>
            <line x1="29.9991" y1="210.007" x2="321.001" y2="210.007" stroke="#E8AA41"/>
            <line x1="29" y1="238.5" x2="320.002" y2="238.5" stroke="#E8AA41"/>
            <defs>
              <pattern id="pattern0" patternContentUnits="objectBoundingBox" width="1" height="1">
                <image href="data:image/png;base64" preserveAspectRatio="none"/>
              </pattern>
            </defs>
          </svg>
          
          <h1 class="text-2xl font-bold text-white mb-2">PAKALON</h1>
          <p class="text-sm text-gray-400">Login to your account</p>
        </div>

        <Show when={!auth.store.code}>
          <div class="flex flex-col gap-4">
            <button
              onClick={handleLogin}
              disabled={auth.store.isLoading}
              class="w-full py-3 px-4 bg-[#E8AA41] text-black font-semibold rounded hover:bg-[#d4993a] transition-colors disabled:opacity-50"
            >
              {auth.store.isLoading ? "Connecting..." : "Start Login"}
            </button>
          </div>
        </Show>

        <Show when={auth.store.code}>
          <div class="flex flex-col items-center gap-4">
            <div class="text-center">
              <p class="text-sm text-gray-400 mb-2">Visit this URL to authenticate:</p>
              <button
                onClick={openVerificationUrl}
                class="text-[#E8AA41] hover:underline text-sm"
              >
                {auth.store.verification_url}
              </button>
            </div>
            
            <div class="flex flex-col items-center gap-2">
              <p class="text-sm text-gray-400">Enter this code on the page:</p>
              <div class="text-4xl font-mono font-bold text-[#E8AA41] tracking-widest">
                {auth.store.code}
              </div>
            </div>

            <Show when={polling()}>
              <p class="text-sm text-gray-400 animate-pulse">Waiting for authentication...</p>
            </Show>
          </div>
        </Show>

        <Show when={error()}>
          <div class="mt-4 p-3 bg-red-500/20 border border-red-500 rounded">
            <p class="text-red-400 text-sm">{error()}</p>
          </div>
        </Show>
      </div>
    </div>
  )
}
