/**
 * Better Auth configuration; returned Auth.authenticate(request) derives a verified Actor (ADR-0005).
 */
export { createAuth, type Actor, type Auth, type AuthOptions } from "./auth.js";
