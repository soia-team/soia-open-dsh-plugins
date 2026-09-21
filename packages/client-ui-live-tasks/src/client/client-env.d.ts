/**
 * Ambient declarations the browser half needs from its build environment.
 *
 * The shared Client tsdown preset compiles `*.module.css` into a hashed class
 * map plus an injected stylesheet; this declaration is the type-side half of
 * that contract. It lives here, next to the only files that import CSS, so the
 * client program does not depend on a framework-wide `vite/client` reference.
 */

declare module '*.module.css' {
  /** Hashed class names of one CSS module, keyed by the authored class name. */
  const classes: Readonly<Record<string, string>>
  export default classes
}
