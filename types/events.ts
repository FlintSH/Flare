// Mirrors the Prisma enum for client components, which can't import runtime
// values from @prisma/client. `lib/permissions/actions.ts` owns the permission
// each action needs; `lib/files/expiry.ts` owns what it does.
export enum ExpiryAction {
  DELETE = 'DELETE',
  SET_PRIVATE = 'SET_PRIVATE',
}
