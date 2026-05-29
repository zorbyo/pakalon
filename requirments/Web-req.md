This is the complete documentation I have, I am going to build the application called as pakalon, and I wanted to build the website for this, like the web application is acting as bridge of authentication between the user and the pakalon cli application.
The working :
The website should contain the pages for documentation, which says the complete working and usage and how to use and setup pakalon in the user's system and also there must the dashboard features where the user will be able to see the usage of the Ai models and the logs from the pakalon cli, and create API key for usage and many more (Should contain all the features that cursor.com has except the app builder part)
And the main part of the working of the application is that, the user must create account/login through the website and then if he logs into the application (pakalon cli), the user must be able to redirect to the website and asking the confirmation of login and then in the pakalon cli there should be 6 digit code to be displayed and if the user enters the 6 digit code correctly the user can be logged in and then use the application, that log in data should be recorded in the backend and should show in the user's dashboard of the application
In the application to track the usage of the application, I have used telemetry and machine ID tracking also
The pages of the application that should have is :
1. Page 1 home page it contains the navbar, application installation command, features and the 3rd part applications that we use.
2. In the navbar it should contain the buttons : Documents, pricing, usage, Login and create account, if the user is already signed in then it should be dashboard button instead of login and create account.
3. In the document page, the entire page is divided into 2 sections and they are : when pakalon-agents are initialized and when they are not initialized. Inside each sections there will be working about each sections also.
4. And in the pricing section the entire page is divided into 2 parts, it shows 2 categories of user pro and free, user and in that the free version says their benefit and the pro version it says its benefits
5. In the pricing page itself the button for the payment will be present when clicked on that it takes to the payment gateway page.
6. After the user is logged the page that the user should see is the dashboard page, in this page, there are some sub sections and each sub sections have pages for them:
1. Usage
2. Billing
3. profile
4. Documentation
5. Contact US
1. In the usage page it should show the user the complete graph of model usage, with contribution heatmap , and also below that the history of how many lines of codes has been written and how many sessions has been created along with the session_id and the user prompts in each session and the codes written and tokens used in each session should be displayed.
2. If the user is pro user he/she may have the billing cycle, the payment mode which they used, the bill for the payment and also the next payment date or due date. And if the user is free user then the user may have the only the option of upgrade to pro plan, like that only it will be present.
3. In the profile page, it should contain the logged in account, and the option for login out, and delete account or change the name of account like that.
4. When the documentation is clicked on the it should redirect to the same documentation page which I have mentioned above,
5. And when the contact us page is clicked on then it should show some details about the company and the mail address to contact and form to submit feedback and contact the company should be present.

The CSS and the UI must be :
For Dark theme :
:root {
--background: oklch(0.9900 0 0);
--foreground: oklch(0 0 0);
--card: oklch(1 0 0);
--card-foreground: oklch(0 0 0);
--popover: oklch(0.9900 0 0);
--popover-foreground: oklch(0 0 0);
--primary: oklch(0.7784 0.1382 76.9573);
--primary-foreground: oklch(1 0 0);
--secondary: oklch(0.9400 0 0);
--secondary-foreground: oklch(0 0 0);
--muted: oklch(0.9700 0 0);
--muted-foreground: oklch(0.4400 0 0);
--accent: oklch(0.9400 0 0);
--accent-foreground: oklch(0 0 0);
--destructive: oklch(0.7784 0.1382 76.9573);
--destructive-foreground: oklch(1 0 0);
--border: oklch(0.9200 0 0);
--input: oklch(0.9400 0 0);
--ring: oklch(0 0 0);
--chart-1: oklch(0.8100 0.1700 75.3500);
--chart-2: oklch(0.7784 0.1382 76.9573);
--chart-3: oklch(0.7200 0 0);
--chart-4: oklch(0.9200 0 0);
--chart-5: oklch(0.5600 0 0);
--sidebar: oklch(0.9900 0 0);
--sidebar-foreground: oklch(0 0 0);
--sidebar-primary: oklch(0 0 0);
--sidebar-primary-foreground: oklch(1 0 0);
--sidebar-accent: oklch(0.9400 0 0);
--sidebar-accent-foreground: oklch(0 0 0);
--sidebar-border: oklch(0.9400 0 0);
--sidebar-ring: oklch(0 0 0);
--font-sans: Geist, sans-serif;
--font-serif: Georgia, serif;
--font-mono: Geist Mono, monospace;
--radius: 0.5rem;
--shadow-x: 0px;
--shadow-y: 1px;
--shadow-blur: 2px;
--shadow-spread: 0px;
--shadow-opacity: 0.18;
--shadow-color: hsl(0 0% 0%);
--shadow-2xs: 0px 1px 2px 0px hsl(0 0% 0% / 0.09);
--shadow-xs: 0px 1px 2px 0px hsl(0 0% 0% / 0.09);
--shadow-sm: 0px 1px 2px 0px hsl(0 0% 0% / 0.18), 0px 1px 2px -1px hsl(0 0% 0% / 0.18);
--shadow: 0px 1px 2px 0px hsl(0 0% 0% / 0.18), 0px 1px 2px -1px hsl(0 0% 0% / 0.18);
--shadow-md: 0px 1px 2px 0px hsl(0 0% 0% / 0.18), 0px 2px 4px -1px hsl(0 0% 0% / 0.18);
--shadow-lg: 0px 1px 2px 0px hsl(0 0% 0% / 0.18), 0px 4px 6px -1px hsl(0 0% 0% / 0.18);
--shadow-xl: 0px 1px 2px 0px hsl(0 0% 0% / 0.18), 0px 8px 10px -1px hsl(0 0% 0% / 0.18);
--shadow-2xl: 0px 1px 2px 0px hsl(0 0% 0% / 0.45);
--tracking-normal: 0em;
--spacing: 0.25rem;
}

.dark {
--background: oklch(0 0 0);
--foreground: oklch(1 0 0);
--card: oklch(0.1400 0 0);
--card-foreground: oklch(1 0 0);
--popover: oklch(0.1800 0 0);
--popover-foreground: oklch(1 0 0);
--primary: oklch(0.7784 0.1382 76.9573);
--primary-foreground: oklch(0 0 0);
--secondary: oklch(0.2500 0 0);
--secondary-foreground: oklch(1 0 0);
--muted: oklch(0.2300 0 0);
--muted-foreground: oklch(0.7200 0 0);
--accent: oklch(0.3200 0 0);
--accent-foreground: oklch(1 0 0);
--destructive: oklch(0.7784 0.1382 76.9573);
--destructive-foreground: oklch(0 0 0);
--border: oklch(0.2600 0 0);
--input: oklch(0.3200 0 0);
--ring: oklch(0.7200 0 0);
--chart-1: oklch(0.8100 0.1700 75.3500);
--chart-2: oklch(0.7784 0.1382 76.9573);
--chart-3: oklch(0.5600 0 0);
--chart-4: oklch(0.4400 0 0);
--chart-5: oklch(0.9200 0 0);
--sidebar: oklch(0.1800 0 0);
--sidebar-foreground: oklch(1 0 0);
--sidebar-primary: oklch(1 0 0);
--sidebar-primary-foreground: oklch(0 0 0);
--sidebar-accent: oklch(0.3200 0 0);
--sidebar-accent-foreground: oklch(1 0 0);
--sidebar-border: oklch(0.3200 0 0);
--sidebar-ring: oklch(0.7200 0 0);
--font-sans: Geist, sans-serif;
--font-serif: Georgia, serif;
--font-mono: Geist Mono, monospace;
--radius: 0.5rem;
--shadow-x: 0px;
--shadow-y: 1px;
--shadow-blur: 2px;
--shadow-spread: 0px;
--shadow-opacity: 0.18;
--shadow-color: hsl(0 0% 0%);
--shadow-2xs: 0px 1px 2px 0px hsl(0 0% 0% / 0.09);
--shadow-xs: 0px 1px 2px 0px hsl(0 0% 0% / 0.09);
--shadow-sm: 0px 1px 2px 0px hsl(0 0% 0% / 0.18), 0px 1px 2px -1px hsl(0 0% 0% / 0.18);
--shadow: 0px 1px 2px 0px hsl(0 0% 0% / 0.18), 0px 1px 2px -1px hsl(0 0% 0% / 0.18);
--shadow-md: 0px 1px 2px 0px hsl(0 0% 0% / 0.18), 0px 2px 4px -1px hsl(0 0% 0% / 0.18);
--shadow-lg: 0px 1px 2px 0px hsl(0 0% 0% / 0.18), 0px 4px 6px -1px hsl(0 0% 0% / 0.18);
--shadow-xl: 0px 1px 2px 0px hsl(0 0% 0% / 0.18), 0px 8px 10px -1px hsl(0 0% 0% / 0.18);
--shadow-2xl: 0px 1px 2px 0px hsl(0 0% 0% / 0.45);
}

@theme inline {
--color-background: var(--background);
--color-foreground: var(--foreground);
--color-card: var(--card);
--color-card-foreground: var(--card-foreground);
--color-popover: var(--popover);
--color-popover-foreground: var(--popover-foreground);
--color-primary: var(--primary);
--color-primary-foreground: var(--primary-foreground);
--color-secondary: var(--secondary);
--color-secondary-foreground: var(--secondary-foreground);
--color-muted: var(--muted);
--color-muted-foreground: var(--muted-foreground);
--color-accent: var(--accent);
--color-accent-foreground: var(--accent-foreground);
--color-destructive: var(--destructive);
--color-destructive-foreground: var(--destructive-foreground);
--color-border: var(--border);
--color-input: var(--input);
--color-ring: var(--ring);
--color-chart-1: var(--chart-1);
--color-chart-2: var(--chart-2);
--color-chart-3: var(--chart-3);
--color-chart-4: var(--chart-4);
--color-chart-5: var(--chart-5);
--color-sidebar: var(--sidebar);
--color-sidebar-foreground: var(--sidebar-foreground);
--color-sidebar-primary: var(--sidebar-primary);
--color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
--color-sidebar-accent: var(--sidebar-accent);
--color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
--color-sidebar-border: var(--sidebar-border);
--color-sidebar-ring: var(--sidebar-ring);

--font-sans: var(--font-sans);
--font-mono: var(--font-mono);
--font-serif: var(--font-serif);

--radius-sm: calc(var(--radius) - 4px);
--radius-md: calc(var(--radius) - 2px);
--radius-lg: var(--radius);
--radius-xl: calc(var(--radius) + 4px);

--shadow-2xs: var(--shadow-2xs);
--shadow-xs: var(--shadow-xs);
--shadow-sm: var(--shadow-sm);
--shadow: var(--shadow);
--shadow-md: var(--shadow-md);
--shadow-lg: var(--shadow-lg);
--shadow-xl: var(--shadow-xl);
--shadow-2xl: var(--shadow-2xl);
}

For light theme :
:root {
--background: oklch(0.9900 0 0);
--foreground: oklch(0 0 0);
--card: oklch(1 0 0);
--card-foreground: oklch(0 0 0);
--popover: oklch(0.9900 0 0);
--popover-foreground: oklch(0 0 0);
--primary: oklch(0.7784 0.1382 76.9573);
--primary-foreground: oklch(1 0 0);
--secondary: oklch(0.9400 0 0);
--secondary-foreground: oklch(0 0 0);
--muted: oklch(0.9700 0 0);
--muted-foreground: oklch(0.4400 0 0);
--accent: oklch(0.9400 0 0);
--accent-foreground: oklch(0 0 0);
--destructive: oklch(0.7784 0.1382 76.9573);
--destructive-foreground: oklch(1 0 0);
--border: oklch(0.9200 0 0);
--input: oklch(0.9400 0 0);
--ring: oklch(0 0 0);
--chart-1: oklch(0.8100 0.1700 75.3500);
--chart-2: oklch(0.7784 0.1382 76.9573);
--chart-3: oklch(0.7200 0 0);
--chart-4: oklch(0.9200 0 0);
--chart-5: oklch(0.5600 0 0);
--sidebar: oklch(0.9900 0 0);
--sidebar-foreground: oklch(0 0 0);
--sidebar-primary: oklch(0 0 0);
--sidebar-primary-foreground: oklch(1 0 0);
--sidebar-accent: oklch(0.9400 0 0);
--sidebar-accent-foreground: oklch(0 0 0);
--sidebar-border: oklch(0.9400 0 0);
--sidebar-ring: oklch(0 0 0);
--font-sans: Geist, sans-serif;
--font-serif: Georgia, serif;
--font-mono: Geist Mono, monospace;
--radius: 0.5rem;
--shadow-x: 0px;
--shadow-y: 1px;
--shadow-blur: 2px;
--shadow-spread: 0px;
--shadow-opacity: 0.18;
--shadow-color: hsl(0 0% 0%);
--shadow-2xs: 0px 1px 2px 0px hsl(0 0% 0% / 0.09);
--shadow-xs: 0px 1px 2px 0px hsl(0 0% 0% / 0.09);
--shadow-sm: 0px 1px 2px 0px hsl(0 0% 0% / 0.18), 0px 1px 2px -1px hsl(0 0% 0% / 0.18);
--shadow: 0px 1px 2px 0px hsl(0 0% 0% / 0.18), 0px 1px 2px -1px hsl(0 0% 0% / 0.18);
--shadow-md: 0px 1px 2px 0px hsl(0 0% 0% / 0.18), 0px 2px 4px -1px hsl(0 0% 0% / 0.18);
--shadow-lg: 0px 1px 2px 0px hsl(0 0% 0% / 0.18), 0px 4px 6px -1px hsl(0 0% 0% / 0.18);
--shadow-xl: 0px 1px 2px 0px hsl(0 0% 0% / 0.18), 0px 8px 10px -1px hsl(0 0% 0% / 0.18);
--shadow-2xl: 0px 1px 2px 0px hsl(0 0% 0% / 0.45);
--tracking-normal: 0em;
--spacing: 0.25rem;
}

.dark {
--background: oklch(0 0 0);
--foreground: oklch(1 0 0);
--card: oklch(0.1400 0 0);
--card-foreground: oklch(1 0 0);
--popover: oklch(0.1800 0 0);
--popover-foreground: oklch(1 0 0);
--primary: oklch(0.7784 0.1382 76.9573);
--primary-foreground: oklch(0 0 0);
--secondary: oklch(0.2500 0 0);
--secondary-foreground: oklch(1 0 0);
--muted: oklch(0.2300 0 0);
--muted-foreground: oklch(0.7200 0 0);
--accent: oklch(0.3200 0 0);
--accent-foreground: oklch(1 0 0);
--destructive: oklch(0.7784 0.1382 76.9573);
--destructive-foreground: oklch(0 0 0);
--border: oklch(0.2600 0 0);
--input: oklch(0.3200 0 0);
--ring: oklch(0.7200 0 0);
--chart-1: oklch(0.8100 0.1700 75.3500);
--chart-2: oklch(0.7784 0.1382 76.9573);
--chart-3: oklch(0.5600 0 0);
--chart-4: oklch(0.4400 0 0);
--chart-5: oklch(0.9200 0 0);
--sidebar: oklch(0.1800 0 0);
--sidebar-foreground: oklch(1 0 0);
--sidebar-primary: oklch(1 0 0);
--sidebar-primary-foreground: oklch(0 0 0);
--sidebar-accent: oklch(0.3200 0 0);
--sidebar-accent-foreground: oklch(1 0 0);
--sidebar-border: oklch(0.3200 0 0);
--sidebar-ring: oklch(0.7200 0 0);
--font-sans: Geist, sans-serif;
--font-serif: Georgia, serif;
--font-mono: Geist Mono, monospace;
--radius: 0.5rem;
--shadow-x: 0px;
--shadow-y: 1px;
--shadow-blur: 2px;
--shadow-spread: 0px;
--shadow-opacity: 0.18;
--shadow-color: hsl(0 0% 0%);
--shadow-2xs: 0px 1px 2px 0px hsl(0 0% 0% / 0.09);
--shadow-xs: 0px 1px 2px 0px hsl(0 0% 0% / 0.09);
--shadow-sm: 0px 1px 2px 0px hsl(0 0% 0% / 0.18), 0px 1px 2px -1px hsl(0 0% 0% / 0.18);
--shadow: 0px 1px 2px 0px hsl(0 0% 0% / 0.18), 0px 1px 2px -1px hsl(0 0% 0% / 0.18);
--shadow-md: 0px 1px 2px 0px hsl(0 0% 0% / 0.18), 0px 2px 4px -1px hsl(0 0% 0% / 0.18);
--shadow-lg: 0px 1px 2px 0px hsl(0 0% 0% / 0.18), 0px 4px 6px -1px hsl(0 0% 0% / 0.18);
--shadow-xl: 0px 1px 2px 0px hsl(0 0% 0% / 0.18), 0px 8px 10px -1px hsl(0 0% 0% / 0.18);
--shadow-2xl: 0px 1px 2px 0px hsl(0 0% 0% / 0.45);
}

@theme inline {
--color-background: var(--background);
--color-foreground: var(--foreground);
--color-card: var(--card);
--color-card-foreground: var(--card-foreground);
--color-popover: var(--popover);
--color-popover-foreground: var(--popover-foreground);
--color-primary: var(--primary);
--color-primary-foreground: var(--primary-foreground);
--color-secondary: var(--secondary);
--color-secondary-foreground: var(--secondary-foreground);
--color-muted: var(--muted);
--color-muted-foreground: var(--muted-foreground);
--color-accent: var(--accent);
--color-accent-foreground: var(--accent-foreground);
--color-destructive: var(--destructive);
--color-destructive-foreground: var(--destructive-foreground);
--color-border: var(--border);
--color-input: var(--input);
--color-ring: var(--ring);
--color-chart-1: var(--chart-1);
--color-chart-2: var(--chart-2);
--color-chart-3: var(--chart-3);
--color-chart-4: var(--chart-4);
--color-chart-5: var(--chart-5);
--color-sidebar: var(--sidebar);
--color-sidebar-foreground: var(--sidebar-foreground);
--color-sidebar-primary: var(--sidebar-primary);
--color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
--color-sidebar-accent: var(--sidebar-accent);
--color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
--color-sidebar-border: var(--sidebar-border);
--color-sidebar-ring: var(--sidebar-ring);

--font-sans: var(--font-sans);
--font-mono: var(--font-mono);
--font-serif: var(--font-serif);

--radius-sm: calc(var(--radius) - 4px);
--radius-md: calc(var(--radius) - 2px);
--radius-lg: var(--radius);
--radius-xl: calc(var(--radius) + 4px);

--shadow-2xs: var(--shadow-2xs);
--shadow-xs: var(--shadow-xs);
--shadow-sm: var(--shadow-sm);
--shadow: var(--shadow);
--shadow-md: var(--shadow-md);
--shadow-lg: var(--shadow-lg);
--shadow-xl: var(--shadow-xl);
--shadow-2xl: var(--shadow-2xl);
}


The teck stack :
Frontend - Next.js, Tailwind css + shadcn UI + Radix UI, react.js,
Backend - python + Fast API
Authentication - Clerk(for account creation and login via github)
and 6 digit device code entering to use application
DBMS - Postgresql
Payment gateway - Polar
analytics - google analytics
Cloud storage - cloudinary or MinIO