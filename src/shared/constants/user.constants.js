/*
| User Roles
*/

export const USER_ROLES = Object.freeze({
  CUSTOMER: "customer",
  ADMIN: "admin",
});

export const USER_ROLE_VALUES = Object.freeze(Object.values(USER_ROLES));

/*
| User Statuses
*/

export const USER_STATUSES = Object.freeze({
  ACTIVE: "active",
  INACTIVE: "inactive",
  BLOCKED: "blocked",
  DELETED: "deleted",
});

export const USER_STATUS_VALUES = Object.freeze(Object.values(USER_STATUSES));

/*
| Password Configuration
*/

export const PASSWORD_HASH_ROUNDS = 12;
