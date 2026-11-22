/**
 * What each administration action's route asks of the signed-in account
 * before it runs, read by the routes and by MCP tools so both gate on one
 * rule. A list means any one of them. The service each action calls checks
 * again under the role lock. No server imports.
 */
import type { Permission } from './catalog'

export const ADMIN_PERMISSIONS = {
  /** List and search accounts. */
  listUsers: ['users.read'],
  /** Read one account. */
  getUser: ['users.read'],
  /** Assigning roles to the new account also needs `assignUserRoles`. */
  createUser: ['users.create'],
  /** Change an account's name, email, password or public IDs. */
  updateUser: ['users.update'],
  /** Change an account's roles, alone or with other fields. */
  assignUserRoles: ['users.roles'],
  /** Read an account's email status, exempt it, require it, or resend its link. */
  manageUserEmail: ['users.email'],
  /** List roles with their member counts, and the permission catalog. */
  listRoles: ['roles.manage', 'users.roles', 'users.read'],
  /** Create, change or delete a role. */
  manageRoles: ['roles.manage'],
  /** List invites; everyone's also needs `invites.manage` in the service. */
  listInvites: ['invites.create', 'invites.manage'],
  createInvite: ['invites.create'],
  /** Revoke your own invite, or anyone's with `invites.manage`. */
  revokeInvite: ['invites.create', 'invites.manage'],
  /** Read the instance settings with secrets blank, and check for updates. */
  readSettings: ['settings.read'],
  /** Let everyone create invites; the service also needs your own `invites.create`. */
  setEveryoneCanInvite: ['settings.security'],
  /** Read and change the email settings, count their impact, and test delivery. */
  manageEmailSettings: ['settings.email'],
  /** Change the appearance studio draft, publish it, or restore it. */
  manageAppearance: ['appearance.manage'],
  readAuditLog: ['audit.read'],
} as const satisfies Record<string, readonly Permission[]>
