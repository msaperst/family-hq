export interface ServerConfig {
  port: number;
  host: string;
  serveClient: boolean;
}

export function getServerConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const port = Number(env.FAMILY_HQ_PORT ?? 3080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid FAMILY_HQ_PORT');
  }
  return {
    port,
    host: env.HOST ?? '127.0.0.1',
    serveClient: env.NODE_ENV === 'production',
  };
}
