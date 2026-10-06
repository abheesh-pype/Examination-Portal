This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Initial administrator setup

The application does not create a default administrator during login. For a new deployment, configure these server-side environment variables before starting the application:

- `INITIAL_ADMIN_SETUP_TOKEN`: a randomly generated secret of at least 32 characters.
- `INITIAL_ADMIN_EMAIL`: the initial administrator's email address.
- `INITIAL_ADMIN_PASSWORD`: the initial administrator's password (at least 12 characters).

Once the application is running, make a one-time `POST` request to `/api/auth/setup` with the setup token in the `x-initial-admin-setup-token` header. For example:

```bash
curl -X POST http://localhost:3000/api/auth/setup \
  -H "x-initial-admin-setup-token: YOUR_SETUP_TOKEN"
```

The endpoint creates the administrator only when the user table is empty and permanently records that setup has completed. It returns no credentials. Keep the setup token private and remove `INITIAL_ADMIN_SETUP_TOKEN` from the deployment environment after setup. Do not expose any of these variables to client-side code.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
