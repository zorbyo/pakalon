import type { Config } from 'tailwindcss'

const config: Config = {
    darkMode: 'class',
    content: [
        './pages/**/*.{js,ts,jsx,tsx,mdx}',
        './components/**/*.{js,ts,jsx,tsx,mdx}',
        './app/**/*.{js,ts,jsx,tsx,mdx}',
    ],
    theme: {
        extend: {
            colors: {
                primary: {
                    DEFAULT: '#d7e19d',
                    hover: '#c6d37e',
                },
                background: {
                    light: '#f7f8f6',
                    dark: '#161712',
                },
                surface: {
                    dark: '#1d1e18',
                    hover: '#25261e',
                },
                border: {
                    dark: '#34362b',
                },
            },
            fontFamily: {
                sans: ['Space Grotesk', 'sans-serif'],
                mono: ['Space Grotesk', 'monospace'],
            },
        },
    },
    plugins: [
        require('@tailwindcss/forms'),
    ],
}

export default config
