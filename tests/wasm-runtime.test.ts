import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';
import { patchRuntime, formatStartupError } from '../experiments/minecraft-26/patch-runtime.mjs';

it('includes the error message when Safari provides a stack with no error heading', () => {
  expect(formatStartupError({ name: 'TypeError', message: 'Invalid module', stack: 'imports@[native code]\nf@runtime.js:1:3414' }))
    .toBe('TypeError: Invalid module\nimports@[native code]\nf@runtime.js:1:3414');
  expect(formatStartupError(new Error('failed'))).toContain('Error: failed');
});

it.skipIf(!existsSync('work/minecraft-26/client-26.2/classes.wasm-runtime.js'))('initializes TeaVM without import reflection when its memory metadata is present', () => {
  const source = readFileSync('work/minecraft-26/client-26.2/classes.wasm-runtime.js', 'utf8');
  const imports = vi.fn(() => { throw new TypeError('Safari import reflection failed'); });
  const customSections = vi.fn(() => [new TextEncoder().encode('{"min":75,"max":555,"imported":false}').buffer]);
  const context: any = { WebAssembly: { ...WebAssembly, validate: () => true, Module: { imports, customSections } }, TextDecoder, FinalizationRegistry, WeakRef, console, setTimeout, clearTimeout };
  vm.runInNewContext(patchRuntime(source), context);
  const runtimeImports: any = {};
  expect(() => context.TeaVM.wasmGC.defaults(runtimeImports, {}, {}, {})).not.toThrow();
  expect(imports).not.toHaveBeenCalled();
  expect(customSections).toHaveBeenCalledWith(expect.anything(), 'teavm.memoryRequirements');
  expect(runtimeImports.teavm.memory).toBeUndefined();
});
