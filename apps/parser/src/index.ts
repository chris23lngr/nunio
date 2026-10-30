import { createParserServer } from "./server.js";

const port = Number(process.env.PORT ?? 10000);
createParserServer().listen(port, () => {
  console.log(JSON.stringify({ msg: "parser listening", port }));
});
