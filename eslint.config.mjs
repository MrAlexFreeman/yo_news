import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    /*
      Android-оболочка (см. `scripts/build-rustore.sh`).

      Здесь нет ни одной строки, написанной вручную на JS/TS: каталог состоит из Gradle-скриптов,
      Java/Kotlin и файлов, которые генерируют `npx cap sync` и сама сборка. Без этого исключения
      `npm run check` после любой сборки APK находил в выдаче Gradle скопированный Capacitor'ом
      `native-bridge.js` и сообщал о полутора десятках замечаний к чужому сгенерированному коду —
      то есть шум, за которым не видно настоящих проблем.
    */
    "android/**",
  ]),
]);

export default eslintConfig;
