-- Löschen removes an Agent for good (#182): its Grants, Courses, Capabilities and Runs go with it through their
-- foreign keys, and with the Runs their Actions, steps and Verlauf. The runtime could not delete an Agent until now.
GRANT DELETE ON "agent" TO nunio_runtime;
