import assert from "node:assert/strict";
import { test } from "node:test";
import { invitationRedirectUrl } from "./clerk-accounts.ts";

test("invitations land on the web sign-up page unless a redirect is configured", () => {
  assert.equal(
    invitationRedirectUrl({ WEB_ORIGINS: " https://apps.example.ca , http://localhost:3001" }),
    "https://apps.example.ca/sign-up",
  );
  assert.equal(
    invitationRedirectUrl({
      WEB_ORIGINS: "http://localhost:3001",
      WEB_INVITATION_REDIRECT_URL: "https://apps.example.ca/sign-up",
    }),
    "https://apps.example.ca/sign-up",
  );
  assert.equal(invitationRedirectUrl({}), undefined);
  assert.equal(invitationRedirectUrl({ WEB_INVITATION_REDIRECT_URL: "not a url" }), undefined);
});
