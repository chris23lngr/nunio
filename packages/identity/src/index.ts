/**
 * Better Auth configuration; returned Auth.authenticate(request) derives a verified Actor (ADR-0005).
 */
export { type Actor, type Auth, type AuthOptions, createAuth } from "./auth.js";
