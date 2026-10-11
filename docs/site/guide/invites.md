---
description: Create invite links so people can join a Flare instance, even while registration is closed, then copy, track, and revoke them.
---

# Invite people

An invite link lets someone create their own account on a Flare instance, even when public registration is closed. You choose how many accounts a link can create and when it expires, and you can see who joined with it.

<Screenshot src="/screenshots/invites/profile-invites.webp" alt="Profile Invites section listing four active single-use invite links with Copy link and Revoke buttons and a note about invite limits" caption="Profile → Invites keeps your links in one place. This member's limits come from the instance settings." />

## Who can invite

Administrators can always create invites. Other people need the **Create invites** permission. An administrator can give it to every account with **Let everyone create invites** in [Settings → Access](/admin/users#invite-links), or to selected people through a [role](/admin/roles). Until then, invites are administrator-only.

If **Profile → Invites** is missing, your roles do not include Create invites. Ask an administrator for an invite-enabled role or for a link for the person you want to invite.

## Create an invite link

1. Open **Profile → Invites** and choose **Create invite**. People who manage accounts can use **Users → Invites** instead; it creates the same kind of link.
2. Optionally add a **Note** such as “For Sam” so you recognize the link later. Only you and people who manage all invites see it. The person you invite never sees the note.
3. Choose **Uses**: how many accounts the link can create. Choose **1 person** unless you are deliberately inviting a group.
4. Choose **Expires after**. A shorter lifetime limits the damage if the link is forwarded.
5. If you can assign roles, optionally select **Roles for new accounts**. Everyone applies automatically, so leave this empty for an ordinary account.
6. Choose **Create invite link**.
7. In **Your invite link is ready**, choose **Copy link**, or **Share…** when your browser offers system sharing. Send the link privately to the person you are inviting, then choose **Done**.

<Screenshot src="/screenshots/invites/create-invite.webp" alt="Create an invite link dialog with the note For Sam Rivera, Uses set to 1 person, Expires after set to 7 days, and the Moderator role selected" caption="Choose uses, an expiry, and optional roles before creating the link." />

<Screenshot src="/screenshots/invites/invite-ready.webp" alt="Your invite link is ready dialog showing a blurred invite link, a Copied button, and the summary Single use, an expiry date, and Grants Moderator" caption="The link is ready to copy. The token is blurred in this screenshot." />

An invite link looks like `https://files.example.com/auth/register?invite=…`, using your instance's address. **Anyone who has the link can use it** until it is used up, expires, or is revoked. Treat it like a password: avoid public channels, and prefer a single use and a short expiry.

Selecting a role that includes **Administrator** shows a warning: anyone who uses that link becomes a full administrator of the instance.

## What the invited person sees

Opening an active link shows **You’re invited** with the name of the person who created the link. If the link grants roles, they appear under **You’ll join with these roles**. The person chooses a **Username**, **Email address**, and **Password**, then chooses **Create account**.

<Screenshot src="/screenshots/invites/register-invite.webp" alt="You're invited page: Alex Morgan invited you to join Flare, with the Moderator role listed above username, email, and password fields" caption="The invite page names the inviter and any roles the link grants." />

<div style="max-width: 390px; margin-inline: auto">
<Screenshot src="/screenshots/invites/register-invite-mobile.webp" alt="You're invited page on a 390-pixel phone screen with the registration form" caption="The same invite page on a phone." />
</div>

The usual registration rules still apply: a username of at least two characters, a valid email address that no other account uses, and a password of at least eight characters (at most 72 UTF-8 bytes when account email is enabled). If the instance requires new users to verify their email, the new account is asked to verify before using Flare. An attempt that fails, such as one using an email address that already has an account, does not use up the invite.

If the link cannot be used, the page explains why, such as **This invite link has already been used.** On an instance with closed registration, the page is titled **Invite unavailable** and offers **Go to sign in**. If public registration is open, the ordinary sign-up form appears with a note that the invite cannot be used; an account created that way does not receive the invite's roles.

<Screenshot src="/screenshots/invites/invite-used.webp" alt="Invite unavailable page saying This invite link has already been used and asking the visitor to request a new link, with a Go to sign in button" caption="A spent link explains what happened instead of showing a blank error." />

## Track your invites

Your list shows each link's note, status, uses, and expiry. When someone joins, their name appears after **Joined**. Use **Show** to switch between **Active invites**, **Ended invites**, and **All invites**.

| Status      | Meaning                                                                                                                                                                                                                          |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Active**  | The link works now.                                                                                                                                                                                                              |
| **Paused**  | Its creator can no longer create invites or grant the link's roles. It resumes automatically if that access returns before the link expires. An administrator turning **Let everyone create invites** off pauses members' links. |
| **Used up** | It created as many accounts as its **Uses** allowed.                                                                                                                                                                             |
| **Expired** | Its expiry time has passed.                                                                                                                                                                                                      |
| **Revoked** | Someone revoked it.                                                                                                                                                                                                              |

Used-up, expired, and revoked links have **ended**: they never work again, even if settings change. Create a new link instead.

**Copy link** is available again for your own active and paused links. Nobody else can copy your link, including administrators. If the operator changed the server's encryption key after you created a link, Flare can no longer show it again; the link still works for anyone who already has it, but you need a new invite to send another copy.

## Revoke an invite

Choose **Revoke** on an active or paused link, then confirm **Revoke invite**. The link stops working immediately. Accounts that already joined with it keep their accounts and roles; revoking an invite never deletes an account. Revoked links move to **Ended invites**.

<Screenshot src="/screenshots/invites/revoke-invite.webp" alt="Revoke this invite confirmation explaining that Old roommate stops working immediately and existing accounts are not affected" caption="Revocation asks for confirmation and leaves existing accounts in place." />

## Limits for members

Unless you can create accounts directly, your invites follow the instance's member limits. By default you can have **5 active invites** at a time, each link works **once**, and every link must expire within **30 days**. The note at the top of **Profile → Invites** shows the limits that apply to you, and the form offers only choices within them. Administrators and others with **Create users** are not limited this way.

An invite counts toward your active limit until it is used up, expires, or is revoked. Paused invites still count. Revoke an invite you no longer need to free a slot.

<div style="max-width: 390px; margin-inline: auto">
<Screenshot src="/screenshots/invites/profile-invites-mobile.webp" alt="Profile Invites on a 390-pixel phone screen with the Create invite button and the member limit note" caption="Invites work on a phone too." />
</div>

## Troubleshooting

| Symptom                                     | What to check                                                                                                                                   |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Profile → Invites** is missing            | Your roles do not include Create invites. Ask an administrator.                                                                                 |
| **Create invite** is disabled               | You reached your active-invite limit. Revoke an invite or wait for one to be used or expire.                                                    |
| A choice such as **Never** is unavailable   | Member limits cap uses and expiry. Ask an administrator if you need a longer-lived or multi-use link.                                           |
| One of your links shows **Paused**          | You can no longer grant a role it includes. Revoke it and create a link without that role, or ask an administrator to restore your role access. |
| Someone says the link is unavailable        | Check the link's status. Create a new link if it ended.                                                                                         |
| **Copy link** is missing for an active link | It belongs to someone else, or the server's encryption key changed. Create a new invite.                                                        |

Administrators can [manage every invite and set member limits](/admin/users#invite-links). Developers can use the [invite API contracts](/api/invites). [Watch the recorded walkthroughs](/demos#invite-someone-with-a-role).
