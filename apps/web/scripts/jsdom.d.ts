// Minimal jsdom shim for the Layer A audio-path harness. @types/jsdom is
// not installed at the workspace root; runtime resolves the JS module via
// apps/web/node_modules/jsdom. Only the surface used by the harness is
// declared here.
declare module "jsdom" {
  export class JSDOM {
    constructor(html: string, options?: Record<string, unknown>);
    readonly window: Window & typeof globalThis;
  }
}
