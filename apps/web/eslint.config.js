import base from "@nunio/eslint-config/base";
import nextVitals from "eslint-config-next/core-web-vitals";

// Next's rules first; the shared base comes last so typescript-eslint's parser applies.
export default [...nextVitals, ...base];
