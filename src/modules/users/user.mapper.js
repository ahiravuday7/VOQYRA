/*
|--------------------------------------------------------------------------
| Public User Mapper
|--------------------------------------------------------------------------
|
| Only fields safe for a customer-facing response
| should be returned here.
|--------------------------------------------------------------------------
*/

export const toPublicUser = (user) => {
  return {
    id: user.id,

    firstName: user.firstName,
    lastName: user.lastName,
    fullName: user.fullName,

    email: user.email,
    phone: user.phone ?? null,

    role: user.role,

    avatar: user.avatar,

    isEmailVerified: user.isEmailVerified,

    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
};
