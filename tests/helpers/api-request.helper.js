import supertest from "supertest";

const WRITE_METHODS = ["post", "put", "patch", "delete"];

const configureClient = (client) => {
  for (const method of WRITE_METHODS) {
    const original = client[method].bind(client);

    client[method] = (...args) =>
      original(...args).set("X-CSRF-Protection", "1");
  }

  return client;
};

const apiRequest = (...args) => configureClient(supertest(...args));

apiRequest.agent = (...args) => configureClient(supertest.agent(...args));

export default apiRequest;
