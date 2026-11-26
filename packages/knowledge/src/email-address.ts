import { z } from "zod";

/** One email address, as a Destination accepts it: never a list, and within SMTP's 254 characters. */
export const emailAddress = z.email().max(254);
