/**
 * Minimal ambient types for "bun:test" so the deterministic tool contract
 * tests typecheck without installing any package. Bun provides the runtime
 * implementation; this only declares the small API surface the tests use.
 */
declare module "bun:test" {
  export interface BunExpect<T> {
    toBe(expected: T): void;
    toEqual(expected: unknown): void;
    toHaveProperty(name: string): void;
    toBeUndefined(): void;
    toBeDefined(): void;
    toBeTrue(): void;
    toBeFalse(): void;
    toContain(expected: T extends (infer U)[] ? U : never): void;
    toBeGreaterThan(expected: number): void;
    toBeLessThan(expected: number): void;
    toBeLessThanOrEqual(expected: number): void;
    toBeGreaterThanOrEqual(expected: number): void;
    readonly not: BunExpect<T>;
  }
  export function expect<T>(actual: T): BunExpect<T>;
  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
}
