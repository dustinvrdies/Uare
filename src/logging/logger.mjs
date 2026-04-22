export function createLogger(runtime = {}) {
  function emit(level, message, meta = {}) {
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      level,
      service: 'uare-custom-backend',
      env: runtime.nodeEnv || 'development',
      message,
      ...meta
    }));
  }
  return {
    info: (message, meta = {}) => emit('info', message, meta),
    warn: (message, meta = {}) => emit('warn', message, meta),
    error: (message, meta = {}) => emit('error', message, meta)
  };
}
