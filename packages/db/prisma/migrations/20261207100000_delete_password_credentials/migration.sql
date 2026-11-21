-- Passwords are gone (ADR-0027): students sign in with an emailed code or a passkey.
DELETE FROM "account" WHERE "providerId" = 'credential';
