declare module "node:crypto" {
  export function createHmac(algorithm: string, key: string): {
    update(data: string): {
      digest(encoding: "base64url" | "hex" | "base64"): string;
    };
  };
  export function timingSafeEqual(actual: Uint8Array, expected: Uint8Array): boolean;
}

declare module "node:fs" {
  export function existsSync(path: string): boolean;
}

declare module "node:fs/promises" {
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>;
  export function appendFile(path: string, data: string, encoding?: string): Promise<void>;
}

declare module "node:path" {
  const path: {
    dirname(value: string): string;
    join(...paths: string[]): string;
  };
  export default path;
}

declare const process: {
  env: Record<string, string | undefined>;
  cwd(): string;
};

declare const Buffer: {
  from(value: string): Uint8Array;
};
