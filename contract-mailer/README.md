# Contract mailer

Emails the signed services agreement when someone signs the page at `/contract/`.

- Test mode (default): every email goes only to `OWNER_EMAIL`. Nothing goes to the client.
- The email is built here from the contract page and the submitted fields. The page cannot make this Worker send arbitrary content.
- Only requests from `ALLOWED_ORIGIN` are accepted.

## Deploy (about 10 minutes)

1. Create a free Resend account at resend.com and make an API key.
   While testing, the sender `onboarding@resend.dev` only delivers to the email on your Resend account, so use fm.mamah@gmail.com for that account.
2. Create a free Cloudflare account, then from this folder run:

   ```
   npm install -g wrangler
   wrangler login
   wrangler secret put RESEND_API_KEY
   wrangler deploy
   ```

   Paste the key when asked. `wrangler deploy` prints the Worker address, like `https://shinafi-contract-mailer.YOURNAME.workers.dev`.
3. Open `contract/index.html`, set `WORKER_URL` near the top of the script to that address, and commit.
4. Sign a test copy on the page. It should arrive at OWNER_EMAIL with a [TEST] subject.

## Turning on the client copy (not before the owner should receive anything)

1. Verify a domain you own in Resend and pick a sender on it, such as `contracts@yourdomain.com`.
2. In `wrangler.toml` set `FROM_EMAIL` to that sender and `SEND_CLIENT_COPY = "true"`, then run `wrangler deploy`.
3. In `contract/index.html` set `TEST_MODE = false` so the test banner disappears.

If the client copy cannot be delivered, the Worker sends the copy to OWNER_EMAIL with a note instead, and the page tells the signer to save their own copy.

## Limit abuse

In the Cloudflare dashboard, add a rate limiting rule for this Worker (for example 5 requests per minute per IP). The honeypot field and origin check stop most bots, but a rate limit covers the rest.
