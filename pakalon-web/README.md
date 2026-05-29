<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Pakalon Web

Marketing website and dashboard for the Pakalon AI CLI.

## Stack

| Component | Technology |
|-----------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v3 |
| Auth | Supabase (GitHub OAuth) |
| UI Components | Radix UI + shadcn/ui |
| State | React Query |
| Data Viz | Recharts |
| Billing | Polar SDK |

## Run Locally

**Prerequisites:** Node.js 20+

```bash
cd pakalon-web
npm install
npm run dev
```

The app will be available at `http://localhost:3000`.

## Environment Variables

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
NEXT_PUBLIC_API_URL=http://localhost:8000  # Backend URL
```

## Auth Flow

1. User clicks "Continue with GitHub" on `/login`
2. Supabase GitHub OAuth redirects to `/api/auth/callback`
3. Backend exchanges Supabase token for Pakalon JWT via `/auth/web-signin`
4. JWT stored in localStorage and sent as Bearer header

## Deployment

```bash
npm run build
npm start
```

Or deploy to Vercel by connecting the repository.
