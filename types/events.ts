// Mirrors the Prisma enum for client components, which can't import runtime
// values from @prisma/client. `lib/files/expiry.ts` owns the permission each
// action needs and what it does.
export enum ExpiryAction {
  DELETE = 'DELETE',
  SET_PRIVATE = 'SET_PRIVATE',
}
