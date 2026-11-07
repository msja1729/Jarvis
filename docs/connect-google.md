# Connect your Google account (Gmail + Google Calendar)

Google asks every app that reads Gmail to have its own "sign-in client". Because Jarvis is a private app, you create that client yourself. It is free, takes about 10 minutes, and you only do it once.

If a friend has already done this, they can send you their **Client ID** and **Client secret** and add your Gmail address as a test user (step 3). Then skip to step 6.

## 1. Create a project

1. Open <https://console.cloud.google.com/> and sign in with your Google account.
2. At the top, click the project picker → **New project**.
3. Name it `Jarvis` and click **Create**. Make sure it is selected at the top.

## 2. Turn on Gmail and Calendar

1. Open **APIs & Services → Library**.
2. Search **Gmail API** → open it → **Enable**.
3. Go back, search **Google Calendar API** → **Enable**.

## 3. Set up the sign-in screen

1. Open **Google Auth Platform** (or **APIs & Services → OAuth consent screen**) and click **Get started**.
2. App name: `Jarvis`. User support email: your email. Click **Next**.
3. Audience: **External**. Click **Next**, add your email as the contact, agree, and **Create**.
4. Open **Audience → Test users → Add users**. Add your own Gmail address (and the addresses of friends who will use your client).

## 4. Create the client

1. Open **Clients → Create client**.
2. Application type: **Desktop app**. Name: `Jarvis`. Click **Create**.
3. Copy the **Client ID** and the **Client secret** shown on screen.

## 5. (Recommended) Stop the weekly sign-out

While the app is in "Testing", Google signs you out of Jarvis every 7 days.
To avoid that: **Audience → Publish app → Confirm**. Nothing becomes public. Google simply stops the 7-day limit. It still works for up to 100 people.

## 6. Paste into Jarvis

1. In Jarvis, open **Tool Hub**.
2. Under **Accounts → Google account**, paste the **Client ID** and **Client secret** and click **Save**.
3. Click **Sign in with Google**. Your browser opens.
4. Pick your account. Google will say **"Google hasn't verified this app"**. That is expected for your own private app: click **Continue**.
5. Tick both boxes (Gmail and Calendar) and click **Continue**.
6. The browser says "You are signed in". Go back to Jarvis. Gmail and Google Calendar now show **Connected** and are switched on.

## Try it

- "Read my 5 latest mails"
- "What's on my calendar tomorrow?"
- "Reply to Ravi saying I'll join" → Jarvis shows the draft, then asks before sending
- "Schedule a meeting with asha@example.com tomorrow at 4 pm" → Jarvis shows the details and asks first

## What Jarvis can and cannot do with this access

- It can read mail, create drafts, send drafts **after you click Yes**, and move mail to the trash **after you click Yes**. It can never permanently delete mail.
- It can read and create calendar events.
- Your sign-in is stored in Windows Credential Manager / macOS Keychain, never in a file.
- To remove access: **Tool Hub → Google account → Disconnect**. You can also remove it at <https://myaccount.google.com/permissions>.
