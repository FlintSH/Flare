---
title: Two-factor authentication and passkeys
description: Protect password sign-in with an authenticator app, save recovery codes, and add a passkey for your Flare account.
---

# Two-factor authentication and passkeys

Open **Profile → Account → Sign-in security** to manage your account's sign-in methods. Two-factor authentication (2FA) adds an authenticator code after your password. A passkey lets you sign in using your device's screen lock, biometric check, or security key instead of typing that password.

These controls belong to your account and remain available without the `profile.update` role permission. They do not change your role, make private files public, or replace the instance's email-verification policy. New accounts start with two-factor authentication off and no registered passkeys. **Require passkey to sign in** is off for new and existing accounts until you explicitly enable it; registering a passkey alone does not turn it on.

When the passkey requirement is off, confirm security changes with your current password and, if enabled, an unused authenticator or authenticator recovery code. A passkey or authenticator-recovery sign-in within the last five minutes can confirm your identity instead. An SSO-only account needs a fresh SSO or passkey sign-in. When the requirement is on, security changes require a passkey or dedicated passkey-recovery sign-in within five minutes; a password, authenticator code, or SSO sign-in cannot replace that proof.

Security dialogs and the password/basic email forms check that confirmation window again when you submit. If it has expired, they keep your edits and restore the required password/code fields or **Confirm with a passkey** prompt before sending the change. An SSO-only account using optional passkeys is asked to confirm with SSO again. Complete that confirmation, then submit again. If the confirmation requirements cannot be refreshed, the change stays unsent. [Updating your account](./account#change-your-password) describes the profile prompts.

For example, if recent recovery proof expires while **Add a passkey** is open, its name stays in the dialog while the required password/code fields return. No enrollment starts until you complete that proof. The [reproducible expiry check](/contributing#security-browser-checks-and-demos) exercises this with real server requests and controlled session time.

<Screenshot src="/screenshots/security/security-overview.webp" alt="Sign-in security with authenticator setup and passkey registration controls, before either method is enabled" caption="Start in Profile → Account → Sign-in security. These screens use an isolated demonstration account." />

[Watch the complete authenticator and recovery walkthrough](/demos#enable-use-and-recover-two-factor-authentication) or [the passkey walkthrough](/demos#create-use-and-remove-a-passkey). Both use the real application with disposable data; the passkey device is explicitly simulated.

## Check where your account is signed in

Use **Profile → Account → Active sessions** to revoke an unfamiliar browser or all browser sessions, including your own. **Login history** helps distinguish a completed sign-in from a failed attempt. [Review the controls and their limits](./account#login-history-and-active-sessions). Session revocation does not disable your passkeys, remove an authenticator, or revoke API credentials; review each compromised credential separately.

## Choose your sign-in method

| Method                                 | What you need                                                                    | When to use it                                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Password                               | Your local Flare password.                                                       | A local account without two-factor authentication, while the passkey requirement is off.                        |
| Password + authenticator               | Your password and a fresh six-digit code from your authenticator app.            | Regular password sign-in after enabling two-factor authentication, while the passkey requirement is off.        |
| Password + authenticator recovery code | Your password and one unused code saved during authenticator setup.              | Your authenticator is unavailable and the passkey requirement is off. Each code works once.                     |
| Passkey                                | A previously registered passkey and its device's verification prompt.            | Sign in without typing your password or a separate authenticator code.                                          |
| Passkey recovery code                  | Your account email address and one dedicated code saved when requiring passkeys. | Emergency access when the passkey requirement is on and your passkeys are unavailable. No password is required. |
| SSO                                    | The instance's identity provider and the provider's own security checks.         | An SSO account while the passkey requirement is off; configure MFA with that provider.                          |

Passkey sign-in requires the device to verify you; it is a separate sign-in method, including for an account that has an authenticator. With **Require passkey to sign in** enabled, normal password and SSO sign-in stop working for that account. Keep a spare registered passkey and the dedicated emergency codes before relying on this setting.

## Set up an authenticator

For a local account that already has a password:

1. Open **Profile → Account → Sign-in security**.
2. Under **Authenticator app**, choose **Set up authenticator**, complete the requested identity confirmation, then choose **Continue**.
3. Scan the displayed QR code with your authenticator app, or enter the setup key manually. Keep the key private: anyone who has it can generate your codes.
4. Enter the six-digit code currently displayed by your authenticator, then choose **Enable two-factor authentication**.
5. Save the ten recovery codes somewhere you can access if you lose your authenticator. They are shown only once. Use **Copy codes** or **Download codes**, then select **I have saved my recovery codes somewhere safe.** and choose **Done**.
6. Choose **Sign in again**. With the passkey requirement off, use your password and a new authenticator code. If you require passkeys, use a passkey or dedicated passkey recovery code; authenticator enrollment does not change that requirement. Enabling protection ends existing browser sessions.

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

This section describes **authenticator recovery codes**. They do not work for an account that requires passkeys. For that account, use the separate [passkey recovery flow](#recover-when-required-passkeys-are-unavailable) and its dedicated codes.

<Screenshot src="/screenshots/security/recovery-login.webp" alt="Recovery sign-in asks for one saved recovery code and explains that each code works once" caption="Use a recovery code after your password when your authenticator is unavailable." />

After a recovery-code sign-in, Flare accepts that recent sign-in as identity proof for **five minutes**. The confirmation dialog says **Your recent recovery code sign-in confirms your identity for this change.** Use this time to replace recovery codes, turn off and re-enroll a lost authenticator, or add a passkey. Even your last unused recovery code is enough to sign in and begin this repair; you do not need to spend a second code within that window. Complete the repair before that window ends when no other sign-in method is available. After five minutes, another fresh sign-in or the normal password-plus-code proof is required. If a recovery code was exposed, choose **Replace recovery codes** in **Sign-in security**, confirm your identity, and save the new set. Replacement invalidates every code in the old set and ends existing browser sessions.

<Screenshot src="/screenshots/security/recovery-repair.webp" alt="Replace recovery codes dialog accepts a recent recovery-code sign-in as identity proof and explains the five-minute confirmation window" caption="Repair access immediately after recovery sign-in. The recent verified sign-in lets you replace codes without spending another one." />

**Turning off** two-factor authentication also requires identity confirmation. It removes the authenticator and invalidates its own recovery codes, then ends existing sessions. With the passkey requirement off, password sign-in no longer asks for an authenticator. If passkeys are required, that requirement and its dedicated recovery set remain in place: password and SSO sign-in stay blocked. Registered passkeys remain available in either case.

To move to a replacement authenticator, first sign in with an available method, then choose **Turn off** and confirm with your password plus a fresh authenticator or unused recovery code, or a recent passkey or recovery-code sign-in. Sign in again, choose **Set up authenticator**, and complete setup on the new device. Save the new recovery set and test a new code before relying on that device.

Password recovery by email changes your password; it does not remove two-factor authentication, registered passkeys, or a passkey requirement. If no permitted sign-in method or matching recovery code remains, contact your operator. The dashboard has no administrator button to bypass another account's factor or passkey requirement. Do not delete your account to troubleshoot sign-in.

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

Passkeys are tied to the instance's hostname. Use the same canonical address where you registered them. Before a hostname change, preserve dedicated passkey recovery codes if your account requires passkeys, or explicitly turn off the requirement while you still have a working passkey. Password/SSO fallback only works with that requirement off. Register new passkeys after moving to the new address.

## Require a passkey for sign-in

[Watch activation, blocked password sign-in, emergency recovery, and explicit disable](/demos#require-a-passkey-and-recover-access) in the real application walkthrough.

**Require passkey to sign in** is an optional account setting for both local-password and SSO-only accounts. Turning it on blocks all password sign-in, including authenticator and recovery-code combinations, and SSO. It retains those saved credentials and bindings; they become eligible again only after you explicitly turn the requirement off, subject to their normal security checks.

Before enabling it:

1. Register a passkey and test **Sign in with a passkey**. A passkey confirmation within the last **five minutes** is required to enable the setting; a password or any recovery code cannot activate it. If prompted in your account, choose **Confirm with a passkey** and complete its device check.
2. Ensure your account has an email address. The emergency recovery flow uses that address to identify your account, including for SSO-only accounts.
3. Return to **Profile → Account → Sign-in security → Passkeys**, choose **Require passkey to sign in**, review the change, and confirm **Require passkey**.
4. In **Save your passkey recovery codes**, save the ten codes shown once. Use **Copy codes** or **Download codes** (the file is `flare-passkey-recovery-codes.txt`), select **I have saved my recovery codes somewhere safe.**, then choose **Done**. These are a separate set from authenticator recovery codes.
5. Sign in again with your passkey. Enabling the requirement ends existing browser sessions. Add a spare passkey while you still have access.

<Screenshot src="/screenshots/security/passkey-required.webp" alt="Require passkey to sign in confirmation explains that password, authenticator, and SSO sign-in will be blocked" caption="Enabling the requirement is a separate, explicit change after confirming a registered passkey." />

Each dedicated recovery code can grant **full account sign-in using only your email address and that code**. No password or authenticator is requested. Keep them private and accessible separately from the device that holds your passkey; never put them in support messages, screenshots, or public files. Replacing the set invalidates all its previous codes.

<Screenshot src="/screenshots/security/passkey-recovery-codes.webp" alt="Save your passkey recovery codes dialog with ten concealed dedicated codes, download and copy actions, and a saved-confirmation checkbox" caption="Save this dedicated set once. These codes grant emergency sign-in without a password; their values are concealed in the capture." />

Email verification and role permissions still apply after passkey or emergency recovery sign-in. API tokens and upload-tool credentials keep working under their existing permissions; this setting protects browser sign-in and does not revoke integrations.

<Screenshot src="/screenshots/security/passkey-required-password.webp" alt="Login rejects the account password and directs the user to a registered passkey or dedicated passkey recovery code" caption="A correct password cannot bypass the requirement. Resetting it does not restore password or SSO sign-in." />

### Turn off the requirement or replace its codes

Use a passkey or dedicated passkey-recovery sign-in within five minutes before changing the requirement or replacing its recovery set. A password, authenticator recovery code, or provider sign-in is insufficient. Choose **Replace passkey recovery codes → Replace codes** to replace the set, or **Allow other sign-in methods → Allow other methods** to turn the requirement off. Both changes end browser sessions. Save any replacement codes before signing in again.

Turning the requirement off invalidates the dedicated passkey recovery set. It preserves registered passkeys, your password/provider binding, authenticator enrollment, and authenticator recovery codes. If local two-factor authentication was enabled, password sign-in asks for that authenticator or one of its own recovery codes again. Enabling the requirement later creates a fresh dedicated set.

Flare refuses to turn it off if it cannot find a configured fallback: a local password with an account email, or the account's matching, enabled SSO provider with its required configuration and no local authenticator blocking SSO. A provider configuration check cannot prove that the provider is reachable or that you still have access. Test the fallback yourself. If disabling is refused, keep your dedicated codes, add a replacement passkey, or ask the operator to restore the configured provider.

## Recover when required passkeys are unavailable

On the login page, choose **Use a passkey recovery code**. Enter your current account email address and one unused **Passkey recovery code**, then choose **Sign in with recovery code**. This recovery option matches the email address without regard to capitalization. These codes also support SSO-only accounts. They do not require access to the email inbox, a password, or the identity provider; the address identifies the account and the code proves access. Authenticator recovery codes are not accepted here.

If older accounts have addresses that differ only by capitalization, dedicated recovery refuses the ambiguous address without consuming the code. The sign-in error stays generic. Ask the operator to [resolve the address collision](/admin/users#account-sign-in-security), or use a registered passkey while that is investigated. Do not share your recovery code with the operator.

If automatic SSO redirects you to the provider, open `/auth/login?local=1` on your Flare instance to reach **Use a passkey recovery code** directly. This also works for an SSO-only account during a provider outage, provided you saved a dedicated code while enabling the passkey requirement.

<Screenshot src="/screenshots/security/passkey-recovery-login.webp" alt="Passkey recovery sign-in accepts a mixed-case account email and dedicated passkey recovery code, without a password field" caption="Capitalization does not affect this recovery lookup. Use the current account email and an unused dedicated code." />

The code is consumed once and the passkey requirement stays on. The recovered session provides **five minutes** of fresh proof to add a replacement passkey, replace the dedicated recovery codes, or explicitly turn off the requirement. Even your last code can begin this repair without spending another code. Complete a recovery action promptly: once the window expires, another fresh passkey or dedicated recovery sign-in is required.

<Screenshot src="/screenshots/security/passkey-recovery-repair.webp" alt="Replace passkey recovery codes dialog accepts the recent dedicated recovery sign-in as proof for issuing a new set" caption="Repair access within five minutes of emergency sign-in. Replacing this set invalidates all older dedicated codes." />

Register and test a replacement passkey, or replace the dedicated codes and save the new set, before relying on continued access. Adding a passkey or changing the recovery set ends browser sessions; sign in again with an available passkey or a new dedicated code. A successful emergency sign-in does not silently restore password or SSO fallback.

<details>
<summary>See required-passkey recovery at mobile width</summary>

<div class="lab-grid two">
<Screenshot src="/screenshots/security/mobile-required-passkey.webp" alt="Mobile sign-in security shows a required passkey, remaining dedicated recovery codes, and controls to replace codes or allow other sign-in methods" caption="The account requirement and emergency repair controls remain available at 390px wide." />
<Screenshot src="/screenshots/security/passkey-recovery-codes-mobile.webp" alt="Mobile passkey recovery-code dialog displays concealed codes in one column with copy, download, and saved-confirmation controls" caption="Long dedicated recovery codes fit a single-column mobile dialog. Secret values are concealed." />
</div>

</details>

### Manage a lost or old device

The passkey list shows your saved names, creation date, and last use so you can identify credentials. **Rename** changes a label after identity confirmation and keeps your sessions active. Choose **Remove** for a passkey you no longer trust, complete identity confirmation, and sign in again with a remaining method. While the passkey requirement is on, Flare refuses to remove your last registered passkey; add a replacement first, or explicitly turn off the requirement using fresh passkey/recovery proof. Removing it from Flare prevents future Flare sign-in with that credential; deleting it from your device or password manager is a separate action.

Before replacing a device, test a second method in a separate browser window. A spare registered passkey can restore access when your authenticator is unavailable.

Even with the requirement off, removing the last passkey needs a configured password/email or matching enabled SSO fallback. Flare will refuse removal when neither remains configured; adding another passkey keeps a working device option available.

## SSO and existing integrations

Flare does not add a local authenticator prompt after an SSO provider's sign-in. SSO-only accounts should enable MFA with their provider when using SSO. If an account has both a local password and a provider binding and then enables local two-factor authentication, use its password plus authenticator/recovery code or a registered passkey; the SSO path does not bypass that local protection. **Require passkey to sign in** blocks SSO for local and SSO-only accounts alike. Its dedicated recovery codes provide emergency access without the provider; only explicit disabling restores the SSO option.

If the instance automatically redirects to SSO, open `/auth/login?local=1` for permitted password, passkey, or dedicated passkey recovery sign-in. Existing local accounts are not automatically linked to a matching provider email. See [the SSO guide](/admin/sso).

[Named API tokens](/api/authentication) and the legacy upload credential remain independent credentials. Enabling two-factor authentication or using a passkey does not add an interactive prompt to your upload scripts, revoke their tokens, or expand their permissions. Review **Profile → Integrations** and rotate/revoke credentials you no longer use.

## Troubleshoot sign-in

| What you see                                           | What to do                                                                                                                                                           |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authenticator codes keep failing                       | Use the code for this instance/account, enable automatic device time, and wait for a new code if the last one was already accepted.                                  |
| Setup or a passkey prompt expired                      | Start the operation again; a previous challenge cannot be retried indefinitely.                                                                                      |
| Recovery code rejected                                 | Choose a different unused code from the current set; old sets stop working after replacement.                                                                        |
| Password or SSO rejected because a passkey is required | Use a registered passkey or the separate passkey recovery option. Resetting a password does not turn the requirement off.                                            |
| Cannot remove the last passkey                         | Register another key first, or explicitly turn off the requirement after a recent passkey or dedicated recovery sign-in.                                             |
| Cannot allow other sign-in methods                     | Keep the dedicated recovery codes and restore a configured password/email or matching enabled SSO fallback; test that method before relying on it.                   |
| Browser cancelled passkey sign-in                      | Retry and choose the device/provider holding this instance's passkey, or use another sign-in method.                                                                 |
| Passkeys unavailable on this address                   | Open the canonical HTTPS address; ask the operator to check `NEXTAUTH_URL` and the reverse proxy.                                                                    |
| Email verification still required                      | Complete the [email-verification flow](./account#verify-your-email); a stronger sign-in method does not waive it.                                                    |
| Sign-in stopped after an operator changed a secret     | Use a saved recovery code or passkey if available, and ask the operator to restore the correct authentication secret; it also protects stored authenticator secrets. |

Keep passwords, QR codes, setup keys, authenticator codes, both types of recovery codes, cookies, and reset links out of screenshots and support reports.
