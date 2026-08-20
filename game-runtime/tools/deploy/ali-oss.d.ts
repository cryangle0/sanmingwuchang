declare module 'ali-oss' {
  interface OssResponse {
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
  }

  interface ObjectResult {
    readonly name: string;
    readonly url: string;
    readonly res: OssResponse;
  }

  interface HeadResult {
    readonly status: number;
    readonly meta: Readonly<Record<string, string>> | null;
    readonly res: OssResponse;
  }

  interface CorsRule {
    readonly allowedOrigin: string | readonly string[];
    readonly allowedMethod: string | readonly string[];
    readonly allowedHeader?: string | readonly string[];
    readonly exposeHeader?: string | readonly string[];
    readonly maxAgeSeconds?: string;
  }

  interface OssClientOptions {
    readonly accessKeyId: string;
    readonly accessKeySecret: string;
    readonly endpoint: string;
    readonly bucket: string;
    readonly secure?: boolean;
    readonly timeout?: number;
    readonly retryMax?: number;
  }

  interface PutOptions {
    readonly mime?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly meta?: Readonly<Record<string, string | number>>;
    readonly timeout?: number;
  }

  export default class OSS {
    constructor(options: OssClientOptions);
    put(name: string, file: string | Buffer, options?: PutOptions): Promise<ObjectResult>;
    head(name: string): Promise<HeadResult>;
    getBucketCORS(bucket: string): Promise<{
      readonly rules: readonly CorsRule[];
      readonly res: OssResponse;
    }>;
    putBucketCORS(
      bucket: string,
      rules: readonly CorsRule[],
    ): Promise<{ readonly res: OssResponse }>;
  }
}
