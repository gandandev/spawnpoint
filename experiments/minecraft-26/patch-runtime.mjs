// TeaVM already records whether memory is imported in this custom section.
// Read it before asking the browser to reflect the complete import table.
export function patchRuntime(source) {
  const before = 'function f(e){return WebAssembly.Module.imports(e).findIndex(({module:e,name:t,kind:n})=>e==="teavm"&&t==="memory"&&n==="memory")>=0}';
  if (source.split(before).length !== 2) throw new Error('TeaVM memory import hook changed');
  return source.replace(before, 'function f(e){const t=p(e);if(typeof t.imported==="boolean")return t.imported;return WebAssembly.Module.imports(e).findIndex(({module:e,name:t,kind:n})=>e==="teavm"&&t==="memory"&&n==="memory")>=0}');
}

export function formatStartupError(error) {
  const message = error?.message ? `${error.name || 'Error'}: ${error.message}` : String(error);
  const stack = error?.stack ? String(error.stack) : '';
  return stack && !stack.startsWith(message) ? `${message}\n${stack}` : stack || message;
}
