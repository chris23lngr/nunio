import { createParserServer } from "./server.js";

// ADR-0009: the parser holds no secrets. Refuse to start if a deployment hands it one, naming the
// variables but never their values.
const secretLike = /SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|_KEY(_|$)|^KEY$|DATABASE_URL|DSN|COOKIE/i;
const secrets = Object.keys(process.env).filter((name) => secretLike.test(name));
if (secrets.length > 0) {
  console.error(JSON.stringify({ msg: "refusing to start with secrets in the environment", names: secrets }));
  process.exit(1);
}

const port = Number(process.env.PORT ?? 10000);
createParserServer().listen(port, () => {
  console.log(JSON.stringify({ msg: "parser listening", port }));
});
