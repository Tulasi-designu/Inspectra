/**
 * Object Storage — evidence truth.
 *
 * Backend selection:
 *   1. Explicit OBJECT_STORAGE_BACKEND=s3 -> S3-compatible storage
 *   2. Explicit OBJECT_STORAGE_BACKEND=local -> Local disk storage
 *   3. Development -> Local disk storage
 *   4. Production + S3 configured -> S3-compatible storage
 *   5. Otherwise -> Local disk storage
 *
 * Stores:
 *   - original images
 *   - field crops
 *   - annotated evidence
 *   - generated reports
 *
 * PostgreSQL stores references (keys + checksums), never large blobs.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

export interface StoredObjectMetadata {
  key: string;
  size: number;
  mimeType: string;
  checksum: string;
  createdAt: string;
  url: string;
  backend: "s3" | "local";
}

export interface ObjectStorageService {
  putObject(
    key: string,
    buffer: Buffer,
    mimeType: string,
    metadata?: Record<string, string>
  ): Promise<StoredObjectMetadata>;

  getObject(key: string): Promise<Buffer | null>;

  deleteObject(key: string): Promise<void>;

  getUrl(key: string): string;

  exists(key: string): Promise<boolean>;

  backendName(): "s3" | "local";

  health(): Promise<{
    ok: boolean;
    backend: string;
    detail?: string;
  }>;
}

/* -------------------------------------------------------------------------- */
/* S3 / MinIO                                                                  */
/* -------------------------------------------------------------------------- */

function s3Configured(): boolean {
  return Boolean(
    process.env.S3_ENDPOINT && process.env.S3_BUCKET
  );
}

class S3ObjectStorageService implements ObjectStorageService {
  private client: any = null;
  private bucket: string;
  private endpoint: string;
  private initError: string | null = null;

  constructor() {
    this.bucket =
      process.env.S3_BUCKET || "inspectra-evidence";

    this.endpoint =
      process.env.S3_ENDPOINT || "http://localhost:9000";
  }

  private async getClient(): Promise<any> {
    if (this.client) {
      return this.client;
    }

    if (this.initError) {
      throw new Error(this.initError);
    }

    try {
      const { S3Client } = await import("@aws-sdk/client-s3");

      const client = new S3Client({
        endpoint: this.endpoint,

        region:
          process.env.S3_REGION || "us-east-1",

        credentials: {
          accessKeyId:
            process.env.S3_ACCESS_KEY || "minioadmin",

          secretAccessKey:
            process.env.S3_SECRET_KEY || "minioadmin",
        },

        forcePathStyle: true,
      });

      /*
       * Ensure bucket exists.
       */
      const {
        HeadBucketCommand,
        CreateBucketCommand,
      } = await import("@aws-sdk/client-s3");

      try {
        await client.send(
          new HeadBucketCommand({
            Bucket: this.bucket,
          })
        );
      } catch {
        await client.send(
          new CreateBucketCommand({
            Bucket: this.bucket,
          })
        );
      }

      this.client = client;

      return client;
    } catch (err) {
      this.initError =
        err instanceof Error
          ? err.message
          : String(err);

      throw err;
    }
  }

  async putObject(
    key: string,
    buffer: Buffer,
    mimeType: string
  ): Promise<StoredObjectMetadata> {
    const client = await this.getClient();

    const {
      PutObjectCommand,
    } = await import("@aws-sdk/client-s3");

    await client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      })
    );

    const checksum = crypto
      .createHash("sha256")
      .update(buffer)
      .digest("hex");

    return {
      key,
      size: buffer.length,
      mimeType,
      checksum,
      createdAt: new Date().toISOString(),
      url: this.getUrl(key),
      backend: "s3",
    };
  }

  async getObject(
    key: string
  ): Promise<Buffer | null> {
    try {
      const client = await this.getClient();

      const {
        GetObjectCommand,
      } = await import("@aws-sdk/client-s3");

      const res = await client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );

      const body = res.Body;

      if (!body) {
        return null;
      }

      if (Buffer.isBuffer(body)) {
        return body;
      }

      const chunks: Buffer[] = [];

      for await (
        const chunk of body as AsyncIterable<Uint8Array>
      ) {
        chunks.push(Buffer.from(chunk));
      }

      return Buffer.concat(chunks);
    } catch (err) {
      console.warn(
        `[Storage] S3 getObject failed for ${key}:`,
        err instanceof Error
          ? err.message
          : String(err)
      );

      return null;
    }
  }

  async deleteObject(key: string): Promise<void> {
    const client = await this.getClient();

    const {
      DeleteObjectCommand,
    } = await import("@aws-sdk/client-s3");

    await client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      const client = await this.getClient();

      const {
        HeadObjectCommand,
      } = await import("@aws-sdk/client-s3");

      await client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );

      return true;
    } catch {
      return false;
    }
  }

  getUrl(key: string): string {
    return `/api/scan/image?key=${encodeURIComponent(key)}`;
  }

  backendName(): "s3" | "local" {
    return "s3";
  }

  async health(): Promise<{
    ok: boolean;
    backend: string;
    detail?: string;
  }> {
    try {
      await this.getClient();

      return {
        ok: true,
        backend: "s3",
      };
    } catch (err) {
      return {
        ok: false,
        backend: "s3",
        detail:
          err instanceof Error
            ? err.message
            : String(err),
      };
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Local Disk Storage                                                          */
/* -------------------------------------------------------------------------- */

class LocalDiskObjectStorageService
  implements ObjectStorageService
{
  private baseDir: string;

  constructor() {
    this.baseDir =
      process.env.OBJECT_STORAGE_DIR ||
      path.join(
        process.cwd(),
        ".scan-store",
        "vault"
      );

    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, {
        recursive: true,
      });
    }
  }

  private resolvePath(key: string): string {
    /*
     * Prevent path traversal.
     */
    const safeKey = key
      .replace(/\.\./g, "")
      .replace(/^[/\\]+/, "");

    return path.join(
      this.baseDir,
      safeKey
    );
  }

  async putObject(
    key: string,
    buffer: Buffer,
    mimeType: string
  ): Promise<StoredObjectMetadata> {
    const filePath = this.resolvePath(key);

    const dir = path.dirname(filePath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, {
        recursive: true,
      });
    }

    fs.writeFileSync(
      filePath,
      buffer
    );

    const checksum = crypto
      .createHash("sha256")
      .update(buffer)
      .digest("hex");

    return {
      key,
      size: buffer.length,
      mimeType,
      checksum,
      createdAt: new Date().toISOString(),
      url: this.getUrl(key),
      backend: "local",
    };
  }

  async getObject(
    key: string
  ): Promise<Buffer | null> {
    try {
      const filePath =
        this.resolvePath(key);

      if (!fs.existsSync(filePath)) {
        console.warn(
          `[Storage] Local object not found: ${filePath}`
        );

        return null;
      }

      return fs.readFileSync(filePath);
    } catch (err) {
      console.warn(
        `[Storage] Local getObject failed for ${key}:`,
        err instanceof Error
          ? err.message
          : String(err)
      );

      return null;
    }
  }

  async deleteObject(
    key: string
  ): Promise<void> {
    const filePath =
      this.resolvePath(key);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  async exists(
    key: string
  ): Promise<boolean> {
    return fs.existsSync(
      this.resolvePath(key)
    );
  }

  getUrl(key: string): string {
    return `/api/scan/image?key=${encodeURIComponent(key)}`;
  }

  backendName(): "local" {
    return "local";
  }

  async health(): Promise<{
    ok: boolean;
    backend: string;
    detail?: string;
  }> {
    try {
      if (!fs.existsSync(this.baseDir)) {
        fs.mkdirSync(this.baseDir, {
          recursive: true,
        });
      }

      fs.accessSync(
        this.baseDir,
        fs.constants.W_OK
      );

      return {
        ok: true,
        backend: "local",
      };
    } catch (err) {
      return {
        ok: false,
        backend: "local",
        detail:
          err instanceof Error
            ? err.message
            : String(err),
      };
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Storage Selection                                                           */
/* -------------------------------------------------------------------------- */

function createStorage(): ObjectStorageService {
  const requestedBackend =
    process.env.OBJECT_STORAGE_BACKEND
      ?.trim()
      .toLowerCase();

  /*
   * Explicit S3 selection.
   */
  if (
    requestedBackend === "s3" &&
    s3Configured()
  ) {
    console.log(
      "[Storage] Using S3-compatible storage:",
      process.env.S3_ENDPOINT
    );

    return new S3ObjectStorageService();
  }

  /*
   * Explicit local selection.
   */
  if (
    requestedBackend === "local"
  ) {
    console.log(
      "[Storage] Using local disk storage"
    );

    return new LocalDiskObjectStorageService();
  }

  /*
   * Development mode:
   * Use local storage by default.
   *
   * This avoids Windows/MinIO configuration
   * problems when running `npm run dev`.
   */
  if (
    process.env.NODE_ENV !== "production"
  ) {
    console.log(
      "[Storage] Development mode -> local disk storage"
    );

    return new LocalDiskObjectStorageService();
  }

  /*
   * Production:
   * Use S3/MinIO when configured.
   */
  if (s3Configured()) {
    console.log(
      "[Storage] Production -> S3-compatible storage:",
      process.env.S3_ENDPOINT
    );

    return new S3ObjectStorageService();
  }

  /*
   * Final fallback.
   */
  console.log(
    "[Storage] S3 not configured -> local disk storage"
  );

  return new LocalDiskObjectStorageService();
}

export const storage: ObjectStorageService =
  createStorage();