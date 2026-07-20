import { loginUser, registerCustomer } from "./auth.service.js";

import { setAuthCookies } from "./auth-cookie.service.js";

import { toPublicUser } from "../users/user.mapper.js";

/*
|--------------------------------------------------------------------------
| Register Customer
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

/*
| Login User
*/

export const login = async (request, response) => {
  const credentials = request.validated.body;

  const { user, tokens } = await loginUser(credentials, {
    ipAddress: request.ip,

    userAgent: request.headers["user-agent"],
  });

  setAuthCookies(response, tokens);

  return response.status(200).json({
    success: true,

    message: "Login successful",

    data: {
      user: toPublicUser(user),
    },
  });
};
