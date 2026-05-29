import path from 'node:path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
    trailingSlash: true,
    turbopack: {
        root: path.resolve(__dirname),
    },
    images: {
        remotePatterns: [
            {
                protocol: 'https',
                hostname: 'picsum.photos',
            },
        ],
    },
}

export default nextConfig
