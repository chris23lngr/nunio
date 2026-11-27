-- Integration Actions (#293): an integration.call's tool arguments are sealed under its Connection's content key,
-- with a hash of them for the gate's idempotency check.
ALTER TABLE "action" ADD COLUMN "sealedArgs" BYTEA;
ALTER TABLE "action" ADD COLUMN "argsHash" TEXT;
