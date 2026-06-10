import assert from "node:assert/strict";
import { handler, lambdaDemoContext } from "./handler.js";

const loginResponse = await handler({
  rawPath: "/auth/login",
  requestContext: {
    http: {
      method: "POST"
    }
  },
  body: JSON.stringify({
    applicationId: lambdaDemoContext.applicationId,
    email: lambdaDemoContext.principalEmail,
    password: lambdaDemoContext.principalPassword
  })
});

assert.equal(loginResponse.statusCode, 200);
const loginPayload = JSON.parse(loginResponse.body);
assert.ok(loginPayload.accessToken);
assert.ok(loginPayload.refreshToken);

const protectedResponse = await handler({
  rawPath: "/billing",
  requestContext: {
    http: {
      method: "GET"
    }
  },
  headers: {
    authorization: `Bearer ${loginPayload.accessToken}`
  }
});

assert.equal(protectedResponse.statusCode, 200);
const protectedPayload = JSON.parse(protectedResponse.body);
assert.equal(protectedPayload.principal.email, lambdaDemoContext.principalEmail);

console.log("Blindfold Lambda reference smoke passed");
console.log(
  JSON.stringify(
    {
      login: {
        statusCode: loginResponse.statusCode
      },
      billing: {
        statusCode: protectedResponse.statusCode,
        principal: protectedPayload.principal
      }
    },
    null,
    2
  )
);
