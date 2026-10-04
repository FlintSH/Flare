---
title: Two-factor authentication and passkeys
description: Protect password sign-in with an authenticator app, save recovery codes, and add a passkey for your Flare account.
---

# Two-factor authentication and passkeys

Open **Profile → Account → Sign-in security** to manage your account's sign-in methods. Two-factor authentication (2FA) adds an authenticator code after your password. A passkey lets you sign in using your device's screen lock, biometric check, or security key instead of typing that password.

These controls belong to your account and remain available without the `profile.update` role permission. They do not change your role, make private files public, or replace the instance's email-verification policy. New and upgraded accounts start with two-factor authentication off and no registered passkeys.

To change a local account's sign-in methods, confirm your current password and, if enabled, an unused authenticator or recovery code. A passkey or recovery-code sign-in within the last five minutes can confirm your identity instead. An SSO-only account needs a fresh SSO or passkey sign-in within five minutes.

<Screenshot src="/screenshots/security/security-overview.webp" alt="Sign-in security with authenticator setup and passkey registration controls, before either method is enabled" caption="Start in Profile → Account → Sign-in security. These screens use an isolated demonstration account." />

[Watch the complete authenticator and recovery walkthrough](/demos#enable-use-and-recover-two-factor-authentication) or [the passkey walkthrough](/demos#create-use-and-remove-a-passkey). Both use the real application with disposable data; the passkey device is explicitly simulated.

## Choose your sign-in method

| Method                   | What you need                                                            | When to use it                                                         |
| ------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Password                 | Your local Flare password.                                               | A local account without two-factor authentication.                     |
| Password + authenticator | Your password and a fresh six-digit code from your authenticator app.    | Regular password sign-in after enabling two-factor authentication.     |
| Password + recovery code | Your password and one unused saved recovery code.                        | Your authenticator is unavailable. Each recovery code works once.      |
| Passkey                  | A previously registered passkey and its device's verification prompt.    | Sign in without typing your password or a separate authenticator code. |
| SSO                      | The instance's identity provider and the provider's own security checks. | An SSO account; configure MFA with that provider.                      |

Passkey sign-in requires the device to verify you; it is a separate sign-in method, including for an account that has an authenticator. Keep another working method available before removing a passkey or replacing a device.

## Set up an authenticator

For a local account that already has a password:

1. Open **Profile → Account → Sign-in security**.
2. Under **Authenticator app**, choose **Set up authenticator**, complete the requested identity confirmation, then choose **Continue**.
3. Scan the displayed QR code with your authenticator app, or enter the setup key manually. Keep the key private: anyone who has it can generate your codes.
4. Enter the six-digit code currently displayed by your authenticator, then choose **Enable two-factor authentication**.
5. Save the ten recovery codes somewhere you can access if you lose your authenticator. They are shown only once. Use **Copy codes** or **Download codes**, then select **I have saved my recovery codes somewhere safe.** and choose **Done**.
6. Choose **Sign in again**, then use your password and a new authenticator code. Enabling protection ends existing browser sessions.

Setup is not enabled until Flare accepts the confirmation code. Setup expires after five minutes. If it expires, start it again and use the newly generated QR code/key. Remove any abandoned entry from your authenticator so you do not accidentally use its old codes.

<Screenshot src="/screenshots/security/totp-setup.webp" alt="Authenticator setup dialog with a QR-code area, manual setup key, and six-digit confirmation field; secret values are concealed" caption="Real setup screen with its QR code and manual key redacted before capture. Your own dialog shows both; do not share either." />

<Screenshot src="/screenshots/security/recovery-codes.webp" alt="Recovery-code dialog with ten concealed codes, Copy codes, Download codes, a saved-confirmation checkbox, and a disabled Done button" caption="Save your codes before continuing. The codes in this real demonstration capture are redacted." />

An SSO-only account uses the identity provider's MFA; Flare does not offer a local authenticator setup for an account without a local password. [SSO behavior](#sso-and-existing-integrations) explains how the sign-in methods interact.

## Sign in with a code

Enter your email address and password on the login page. If your account has two-factor authentication enabled, **Verify your identity** asks for the current authenticator code before sign-in completes.

Use the most recent six-digit code. A code that has already been accepted cannot be reused; wait for the next code when signing in again or confirming another sensitive change. Set your phone's date and time automatically if fresh codes fail. After too many attempts, wait 15 minutes before trying again.

<Screenshot src="/screenshots/security/totp-login.webp" alt="Flare sign-in asks to verify identity with an authenticator code and offers Use a recovery code" caption="Your password is the first step. Enter a fresh authenticator code to finish signing in." />

If you return to the password step, enter your credentials again. An unfinished code prompt is not a signed-in session and cannot access your files.

## Recover when your authenticator is unavailable

At **Verify your identity**, choose **Use a recovery code**. Enter one unused code from your saved set. You still need your password; a recovery code alone does not sign you in.

<Screenshot src="/screenshots/security/recovery-login.webp" alt="Recovery sign-in asks for one saved recovery code and explains that each code works once" caption="Use a recovery code after your password when your authenticator is unavailable." />

After a recovery-code sign-in, Flare accepts that recent sign-in as identity proof for **five minutes**. The confirmation dialog says **Your recent recovery code sign-in confirms your identity for this change.** Use this time to replace recovery codes, turn off and re-enroll a lost authenticator, or add a passkey. Even your last unused recovery code is enough to sign in and begin this repair; you do not need to spend a second code within that window. Complete the repair before that window ends when no other sign-in method is available. After five minutes, another fresh sign-in or the normal password-plus-code proof is required. If a recovery code was exposed, choose **Replace recovery codes** in **Sign-in security**, confirm your identity, and save the new set. Replacement invalidates every code in the old set and ends existing browser sessions.

<Screenshot src="/screenshots/security/recovery-repair.webp" alt="Replace recovery codes dialog accepts a recent recovery-code sign-in as identity proof and explains the five-minute confirmation window" caption="Repair access immediately after recovery sign-in. The recent verified sign-in lets you replace codes without spending another one." />

**Turning off** two-factor authentication also requires identity confirmation. It removes the authenticator and invalidates its recovery codes, then ends existing sessions. Password sign-in no longer asks for an authenticator afterward; registered passkeys remain a separate sign-in method.

To move to a replacement authenticator, first sign in with an available method, then choose **Turn off** and confirm with your password plus a fresh authenticator or unused recovery code, or a recent passkey or recovery-code sign-in. Sign in again, choose **Set up authenticator**, and complete setup on the new device. Save the new recovery set and test a new code before relying on that device.

Password recovery by email changes your password; it does not remove two-factor authentication or registered passkeys. If you cannot use an authenticator, a recovery code, or any registered passkey, contact your operator. The dashboard has no administrator button to bypass another account's factor. Do not delete your account to troubleshoot sign-in.

<details>
<summary>See the recovery controls at mobile width</summary>

<div class="lab-grid two">
<Screenshot src="/screenshots/security/mobile-security.webp" alt="Mobile sign-in security shows an enabled authenticator, eight remaining recovery codes, replacement and turn-off controls, and Add a passkey" caption="At 390px wide, the same controls remain available in your account." />
<Screenshot src="/screenshots/security/recovery-codes-mobile.webp" alt="Mobile recovery-code dialog with all ten secret values concealed, download and copy controls, the saved-confirmation checkbox, and Done" caption="Save the replacement codes and confirm before continuing. Secret values are redacted from this real capture." />
</div>

</details>

## Add a passkey

You can save up to **10 passkeys**, each with a name of **1–64 characters**. Use the instance's normal HTTPS address in a browser that supports passkeys. Localhost is allowed for development; a plain HTTP address on another host does not support this workflow.

1. Open **Profile → Account → Sign-in security → Passkeys**.
2. Choose **Add a passkey**, give it a name that helps you identify the device, and complete the requested identity confirmation.
3. Follow your browser or operating system's prompt to save the passkey. It may offer a password manager, this device, or a security key.
4. Complete the device verification prompt. Cancelling it leaves no registered passkey in Flare.
5. After registration succeeds, sign in again with **Sign in with a passkey** and the device prompt.

<Screenshot src="/screenshots/security/passkey-create.webp" alt="Add a passkey dialog naming Personal laptop and requesting current-password confirmation before Create passkey" caption="Give the passkey a recognizable name and confirm your identity before the browser begins registration." />

<Screenshot src="/screenshots/security/passkey-added.webp" alt="Sign-in security lists Personal laptop with its added and last-used dates, rename and remove actions, and Add a passkey" caption="The registered passkey appears after a successful real server registration and sign-in. The demonstration uses a virtual authenticator in place of a physical device." />

The browser's choice of devices and whether a passkey syncs between them depends on your platform and passkey provider. Flare stores the public credential, not the passkey's private key or your biometric data.

Passkeys are tied to the instance's hostname. Use the same canonical address where you registered them. If the operator moves Flare to a different hostname, use your password and authenticator/recovery code or SSO, then register new passkeys on the new address.

### Manage a lost or old device

The passkey list shows your saved names, creation date, and last use so you can identify credentials. **Rename** changes a label after identity confirmation and keeps your sessions active. Choose **Remove** for a passkey you no longer trust, complete identity confirmation, and sign in again with a remaining method. Removing it from Flare prevents future Flare sign-in with that credential; deleting it from your device or password manager is a separate action.

Before replacing a device, test a second method in a separate browser window. A spare registered passkey can restore access when your authenticator is unavailable.

## SSO and existing integrations

Flare does not add a local authenticator prompt after an SSO provider's sign-in. SSO-only accounts should enable MFA with their provider. If an account has both a local password and a provider binding and then enables local two-factor authentication, use its password plus authenticator/recovery code or a registered passkey; the SSO path does not bypass that local protection.

If the instance automatically redirects to SSO, open `/auth/login?local=1` for local password and passkey sign-in. Existing local accounts are not automatically linked to a matching provider email. See [the SSO guide](/admin/sso).

[Named API tokens](/api/authentication) and the legacy upload credential remain independent credentials. Enabling two-factor authentication or using a passkey does not add an interactive prompt to your upload scripts, revoke their tokens, or expand their permissions. Review **Profile → Integrations** and rotate/revoke credentials you no longer use.

## Troubleshoot sign-in

| What you see                                       | What to do                                                                                                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authenticator codes keep failing                   | Use the code for this instance/account, enable automatic device time, and wait for a new code if the last one was already accepted.                                  |
| Setup or a passkey prompt expired                  | Start the operation again; a previous challenge cannot be retried indefinitely.                                                                                      |
| Recovery code rejected                             | Choose a different unused code from the current set; old sets stop working after replacement.                                                                        |
| Browser cancelled passkey sign-in                  | Retry and choose the device/provider holding this instance's passkey, or use another sign-in method.                                                                 |
| Passkeys unavailable on this address               | Open the canonical HTTPS address; ask the operator to check `NEXTAUTH_URL` and the reverse proxy.                                                                    |
| Email verification still required                  | Complete the [email-verification flow](./account#verify-your-email); a stronger sign-in method does not waive it.                                                    |
| Sign-in stopped after an operator changed a secret | Use a saved recovery code or passkey if available, and ask the operator to restore the correct authentication secret; it also protects stored authenticator secrets. |

Keep passwords, QR codes, setup keys, authenticator codes, recovery codes, cookies, and reset links out of screenshots and support reports.
