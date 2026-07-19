import { registerCustomer } from "./auth.service.js";

import { toPublicUser } from "../users/user.mapper.js";

/*
|--------------------------------------------------------------------------
| Register Customer Controller
|--------------------------------------------------------------------------
*/

export const register = async (request, response) => {
  const registrationData = request.validated.body;

  const user = await registerCustomer(registrationData);

  return response.status(201).json({
    success: true,

    message: "Account created successfully",

    data: {
      user: toPublicUser(user),
    },
  });
};
