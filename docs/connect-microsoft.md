# Connect your Microsoft account (Outlook mail + calendar)

Microsoft asks every app that reads Outlook to be registered. Because Jarvis is a private app, you register it yourself. It is free, takes about 5 minutes, and you only do it once. There is no password or secret to copy, only an ID.

If a friend has already done this, they can just send you their **Application (client) ID**. Skip to step 3.

## 1. Register Jarvis

1. Open <https://entra.microsoft.com/> and sign in.
   - With a work or school account this usually just works.
   - With a personal Outlook.com / Hotmail account, Microsoft may first ask you to create a free Azure account so you have a place to register apps.
2. Go to **Applications → App registrations → New registration**.
3. Name: `Jarvis`.
4. Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**.
5. Redirect URI: choose **Public client/native (mobile & desktop)** and type `http://localhost`
6. Click **Register**.

## 2. Copy the ID

On the app's **Overview** page, copy the **Application (client) ID**.

You do not need to add permissions by hand. Jarvis asks for them when you sign in: read and write mail, send mail, and read and write your calendar.

## 3. Paste into Jarvis

1. In Jarvis, open **Tool Hub**.
2. Under **Accounts → Microsoft account**, paste the **Client ID** and click **Save**.
3. Click **Sign in with Microsoft**. Your browser opens.
4. Pick your account and click **Accept** on the permissions screen.
   - Work accounts: if it says an administrator must approve, ask your IT team, or use a personal account.
5. The browser says "You are signed in". Go back to Jarvis. Outlook Mail and Outlook Calendar now show **Connected** and are switched on.

## Try it

- "Read my latest Outlook mails"
- "What's on my Outlook calendar today?"
- "Draft a mail to hr@company.com asking about leave policy"

## Good to know

- Deleting moves mail to **Deleted Items**, and always asks you first.
- Your sign-in is stored in Windows Credential Manager / macOS Keychain, never in a file.
- To remove access: **Tool Hub → Microsoft account → Disconnect**. You can also remove it at <https://account.live.com/consent/Manage> (personal) or <https://myapps.microsoft.com> (work).
