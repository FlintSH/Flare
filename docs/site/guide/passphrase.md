---
title: Passphrase and recovery phrase
description: Sign in with a passphrase that never leaves your browser, save your recovery phrase, unlock your encryption keys, change your passphrase, and know what cannot be recovered.
---

# Passphrase and recovery phrase

Your Flare account has **encryption keys**. Your browser makes them, and only your **passphrase** opens them. The passphrase never leaves your browser: Flare receives a signature made from it, never the passphrase itself, so nobody who runs the server can read it, reset it, or tell you what it was.

A **recovery phrase** of 24 words is the second way to open the same keys. You see it when the keys are made. Save it offline.

::: tip These keys encrypt your files
New uploads are encrypted on your device with keys that only your passphrase or your recovery phrase opens. [Encrypted and plain files](./encryption) describes what is encrypted, what the server still sees, and which files stay plain.
:::

## What each secret does

| Secret                 | You use it to                                                                                                          | Flare stores                                                      | If you lose it                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Passphrase             | Sign in, unlock your keys in a browser, change the passphrase, show the recovery phrase.                               | A public key and a salt. Not the passphrase and not a hash of it. | Use the recovery phrase with an [emailed reset link](#forgot-your-passphrase).   |
| Recovery phrase        | Choose a new passphrase and keep your keys when you forgot the old one.                                                | Nothing. The 24 words exist only where you saved them.            | Show it again from **Profile** while you still know the passphrase.              |
| Both                   |                                                                                                                        |                                                                   | The account can get new keys, but its encrypted files can never be opened again. |
| Authenticator, passkey | Prove that it is you at sign-in. They do not open your keys. See [two-factor authentication and passkeys](./security). | As before.                                                        | Use their recovery codes.                                                        |

## Choose a passphrase

Flare measures a new passphrase in your browser with the zxcvbn estimator and accepts it at **Strong** or **Very strong**. It has no fixed length or character rules. Several unrelated words work well, and longer is stronger than complicated. Your email address, your username, and the name of the instance count as known words, so a passphrase made of them scores lower.

The check exists because of what the passphrase protects. Anyone who gets a copy of the server's database can try passphrases against it on their own hardware, as fast as that hardware allows. Flare makes each try slow and memory-hungry (Argon2id with 64 MiB of memory and 3 passes), and the rest depends on the passphrase. See [what the design does not protect](#what-the-design-does-not-protect).

The estimate runs in your browser only. The server cannot check a passphrase that it never receives.

## Create an account

On the registration page, or from an [invite link](./invites):

1. Enter a **Username** and your **Email address**.
2. Enter a **Passphrase** and repeat it in **Confirm passphrase**. The meter under the field shows the estimate and, for a weak one, the reason.
3. Choose **Create account**. The button reads **Deriving your keys…** while your browser stretches the passphrase. This takes under a second on a current desktop and longer on a phone.
4. Flare shows your **recovery phrase**. Write the 24 words down in order, or use **Copy** or **Download as text** and move the copy offline. Tick **I saved my recovery phrase somewhere offline** and choose **Continue**.
5. Type the three words that Flare asks for, to prove your copy is right, and choose **Finish**.

<Screenshot src="/screenshots/encryption/register.webp" alt="Create an account form with Username, Email address, Passphrase with a four-part strength meter reading Very strong, and Confirm passphrase" caption="The meter measures the passphrase in your browser. The form sends public keys and a sealed record, never the passphrase." />

<Screenshot src="/screenshots/encryption/recovery-phrase.webp" alt="Recovery phrase step with 24 numbered words hidden for this capture, Copy and Download as text buttons, a checkbox to confirm it is saved offline, and a disabled Continue button" caption="The words are hidden in this capture. Continue stays disabled until you confirm that you saved them, and the next step asks for three of them." />

The first administrator does the same in [first-run setup](/admin/setup).

## Sign in

1. Enter your **Email address** and choose **Continue**. Flare answers with the form your account uses.
2. Enter your **Passphrase** and choose **Sign in**. Your browser derives your keys, signs a one-time challenge from the server, and sends the signature.
3. If you turned on two-factor authentication, enter your authenticator code or a recovery code. Flare reuses the keys it just derived, so this step does not wait a second time.

After the sign-in your browser fetches your sealed keys, opens them with the passphrase keys, and keeps the account key for the session. An unknown address and a wrong passphrase get the same answer, **Invalid email or passphrase**.

<Screenshot src="/screenshots/encryption/sign-in-passphrase.webp" alt="Sign-in card showing the entered email address with a Change link, a Passphrase field, a note that the passphrase stays in this browser, and a Sign in button" caption="The second step of sign-in. Change returns to the address." />

Passkey and SSO sign-in still work as [their guide](./security) describes. They prove who you are but give your browser no secret, so after such a sign-in Flare asks for your passphrase to [unlock your keys](#unlock-your-keys-in-a-browser).

## Accounts from before passphrases

An account that was created before this release, or that an administrator created for you with a temporary password, has no keys yet. The first step of sign-in shows a **Password** field for it. Directly after that sign-in, **Set up encryption** opens, and the rest of Flare stays closed until you finish it:

- If your current password passes the strength check, you can **Keep my current password**. It becomes your passphrase. The server has seen that password at every earlier sign-in; choose a new passphrase if you want one it never saw.
- If it does not pass, you must **Choose a new passphrase**.
- An account that signs in with a passkey or SSO only chooses a passphrase here as well.

Then you save your recovery phrase as a new account does. From that moment the password is gone from the server: the address signs in with the passphrase.

<Screenshot src="/screenshots/encryption/key-setup.webp" alt="Set up encryption card offering Keep my current password, selected, and Choose a new passphrase, with a Set up encryption button and the signed-in address" caption="A strong password can stay. The note under the second choice says why you might replace it anyway." />

Flare accepts key setup only within **five minutes** of the sign-in. If you wait longer, the page says that your sign-in is more than five minutes old and that nothing was changed. Choose **Sign in again** and set it up right away.

## Unlock your keys in a browser

A browser can be signed in without holding your keys: after a passkey or SSO sign-in, after you cleared the site's data, or when the key store of that browser is empty for another reason. Flare then shows **Your encryption keys are locked in this browser** at the top of the dashboard.

1. Choose **Unlock**. Directly after a passkey or SSO sign-in the dialog opens by itself, one time.
2. Enter your passphrase and choose **Unlock**.

The notice does not block the page. Until files are encrypted, nothing in Flare needs the key, so you can choose **Not now** and keep working.

<Screenshot src="/screenshots/encryption/unlock.webp" alt="Dashboard with a notice that the encryption keys are locked in this browser and an Unlock dialog asking for the passphrase, with Not now and Unlock buttons" caption="Unlocking checks the passphrase with the server and opens the keys in this browser." />

Your browser keeps the account key in its IndexedDB storage while you are signed in. It erases the key when you sign out, when your session ends, and when another account signs in on the same browser. It never stores the passphrase or the recovery phrase.

## Show your recovery phrase again

Open **Profile → Account → Passphrase and recovery**, choose **Show recovery phrase**, and enter your passphrase. Make sure nobody can see your screen. Use this if you are not sure that your saved copy is complete.

## Change your passphrase

A passphrase change makes **new keys**. Someone who knew the old passphrase may also have the old keys, so Flare never keeps the keys and swaps only the passphrase. Change it when another person may know your passphrase, saw your recovery phrase, or used a device where you were signed in.

Before you start, know what it cancels:

- **Every session ends**, on every device and in the browser you use for the change. You sign in again with the new passphrase.
- **Every API token is deleted, and the upload token from before encryption is revoked.** Screenshot tools and scripts stop uploading. A configuration also holds your account's public key, which is new now, so [create a new configuration](./screenshot-tools#create-a-configuration) for each tool, or give a custom integration a [new token](/api/authentication). `flare-upload` with an old configuration exits with code 3 and says to download a new one.
- **You get a new recovery phrase.** The old one stops working.
- An unfinished email address change and links that Flare already emailed you are cancelled.

Your files, folders, tags, two-factor authentication, recovery codes, passkeys, and passkey requirement do not change. Share links of files and folders keep working.

Two things happen to your library, both without any action from you:

- **Folder keys and tags are sealed again for the new key.** The same request that changes the passphrase carries a new sealed copy of each folder's key and of each tag's name and rule. If Flare says the request does not cover every folder and tag, another tab changed one while you worked: reload the page and start again.
- **Your files move to the new key in the background.** Each encrypted file has a small record that gives its key to your account key. After you sign in again, your browser opens each record with the old key and makes one for the new key. A status at the edge of the page reads **Updating file keys** with a count. You can use Flare meanwhile, close the tab, or sign in on another device; the work continues where it stopped. When no file is left on the old key, your browser tells the server to forget that old key.

1. Open **Profile → Account → Passphrase and recovery** and choose **Change passphrase**.
2. Read the list and choose **Continue**.
3. Enter your **Current passphrase**, then the **New passphrase** twice. The new one must pass the strength check and differ from the current one.
4. Choose **Change passphrase and sign out**. Keep the page open while both sets of keys are derived.
5. Save the **new recovery phrase** and type the three words back.
6. Choose **Sign in again** and sign in with the new passphrase.

<Screenshot src="/screenshots/encryption/change-passphrase.webp" alt="Change your passphrase dialog listing that every session ends, every API token is deleted, and a new recovery phrase replaces the current one, with Cancel and Continue buttons" caption="The dialog states the consequences before it asks for anything." />

If the dialog closes or the tab is lost after step 4, the change already happened. Sign in with the new passphrase and use **Show recovery phrase** to save the new words.

## Forgot your passphrase

Flare cannot restore a passphrase. If the instance offers [recovery by email](/admin/email), you can choose a new one from a reset link:

1. On the sign-in page choose **Forgot your passphrase?**, enter your account email address, and choose **Send reset link**. The link arrives only for an address that is verified.
2. Open the link. Flare asks which of two things is true.

<Screenshot src="/screenshots/encryption/reset-choose.webp" alt="Reset your passphrase page offering two choices: I have my recovery phrase, which keeps access to encrypted files, and I lost my recovery phrase, which makes the encrypted files unreadable" caption="The two paths have different results. Read both before you choose." />

### I have my recovery phrase

Enter the 24 words. Capital letters and extra spaces do not matter. Your browser checks them against your account's public key before anything is sent; the words themselves are never sent. Then choose a new passphrase and save the **new recovery phrase** that replaces the one you typed.

This keeps your keys' history, so files encrypted before the change stay readable. Like a passphrase change, it ends every session and cancels every API token.

If Flare says the phrase is valid but not the current one of this account, you typed an older phrase. Every passphrase change, recovery, and reset replaces the recovery phrase; use the newest one you saved.

### I lost my recovery phrase

You can keep the account. It gets new keys, and **no key of the account opens the files it encrypted before, for you or for anyone else. Not an administrator, not the operator of the server, not the Flare project.** Files that are not encrypted, your settings, your two-factor authentication, and your passkeys are kept.

Tick the confirmation, choose a new passphrase, choose **Reset account keys**, and save the new recovery phrase.

After the reset your library looks like this:

- Each encrypted file you had is still listed, as **Unreadable file**, with a **Delete** button. Delete the ones you do not want counted against your storage. A person who has such a file's own share link can still open it until you delete it, because that link carries the file's key.
- Folders and tags keep their files, but their names were sealed with the old key and are lost. They come back as **Folder** and **Tag** with a short code; rename them. Automatic tag rules are lost and need to be entered again.
- Shared folder links stop working. Share the folder again to get a new link.
- Plain files are as they were.

<Screenshot src="/screenshots/encryption/reset-warning.webp" alt="Reset page for a lost recovery phrase, with a red warning that encrypted files stay unreadable for good, new passphrase fields, a confirmation checkbox, and a Reset account keys button" caption="A reset needs an explicit confirmation. Nothing is changed before it." />

A reset link works once. A link that was already used, has expired, or was cut off when copied says so; choose **Request a new link**.

Whoever can read your mailbox can do this reset and take over the account. They get its plain files and settings. They do not get its encrypted files. Turn on [two-factor authentication or require a passkey](./security): neither is removed by a reset, so sign-in still asks for it afterwards.

## Confirm it is you for account changes

Changing your email address, your authenticator, or your passkeys asks for proof that the account's owner is present. A password account typed its password for that. A passphrase cannot be typed into such a form, because the server must never receive it.

Instead, the proof is **a passphrase sign-in within the last five minutes**:

- If you signed in with your passphrase a moment ago, the form says **Your recent passphrase sign-in confirms your identity for this change** and asks for nothing else, except an authenticator code where a password account would also need one.
- Otherwise the form shows **Confirm passphrase**. Enter your passphrase there, and your authenticator or recovery code if you have two-factor authentication. Flare signs your open account in again in place, and you continue where you were.

An authenticator code works once. If you used one to confirm your passphrase, a security change that also needs a code asks for the next one, about 30 seconds later. A saved recovery code avoids the wait.

With **Require passkey to sign in** on, the passkey rules apply instead, as [the security guide](./security#require-a-passkey-for-sign-in) describes.

## What the design does not protect

These limits are accepted in Flare's [encryption design](https://github.com/FlintSH/Flare/blob/main/docs/e2ee-spec.md). Know them before you rely on it.

- **A copy of the database allows offline guessing.** The database holds your keys sealed with a key from your passphrase. Someone who copies it cannot sign in with it, but can test passphrases on their own machines without Flare's rate limits. Only the strength of the passphrase and the cost of each guess stand in the way. Backups contain the same data.
- **A second factor does not protect a database copy.** An authenticator or a passkey stops a person who knows your passphrase from getting your sealed keys from the server. It does nothing against someone who already has the database, and nothing on a browser that unlocked before.
- **An unlocked browser holds your key.** While you are signed in, the account key is in that browser's storage. Malware, a malicious extension, or a person with access to the unlocked profile can use it. Sign out on shared devices.
- **The server delivers the application.** Whoever controls the server or its **Custom head** setting can serve code that reads keys as you type your passphrase. Encryption protects your data from a copied database, a stolen disk, and a curious look at storage. It does not protect you from an operator who changes the application.
- **Nobody can recover what both secrets protected.** With the passphrase and the recovery phrase both lost, the account can be reset, and its encrypted files are gone for good. No administrator action and no support request changes that.
- **An email takeover takes the account.** A reset link is enough to replace the keys. See [above](#i-lost-my-recovery-phrase).

## Troubleshooting

| What you see                                                  | What to do                                                                                                              |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **This passphrase is too easy to guess**                      | Make it longer or add unrelated words. Do not build it from your address, your username, or the instance name.          |
| **The strength check could not load**                         | The page could not download its word lists. Check the connection and reload.                                            |
| **Invalid email or passphrase**                               | Check the address on the first step and the passphrase. Spaces at the start and end of a passphrase count.              |
| The first step shows **Password** for your address            | Your account has no keys yet. Sign in with the password, then [set up encryption](#accounts-from-before-passphrases).   |
| **Your sign-in is more than five minutes old**                | Choose **Sign in again**, then finish **Set up encryption** without a break.                                            |
| **That passphrase is not correct** in a dialog                | The passphrase did not match the keys of the signed-in account. If you changed it on another device, use the new one.   |
| The locked notice returns after every sign-in                 | You sign in with a passkey or SSO, which cannot open keys. Unlock with your passphrase, or sign in with the passphrase. |
| A screenshot tool stopped uploading after a passphrase change | Its token was cancelled with the change. [Install its configuration again](./screenshot-tools).                         |
| **Too many sign-in attempts**                                 | Wait 15 minutes. Passphrase and password attempts for an address share one limit.                                       |
| **This account uses a newer version of Flare's encryption**   | The page in your browser is older than the account's record. Reload it, or ask your administrator to update Flare.      |
