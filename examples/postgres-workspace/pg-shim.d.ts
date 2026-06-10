// Minimal ambient declaration for the optional `pg` driver used by this example.
// Avoids adding @types/pg as a workspace dependency for a demo-only package.
declare module "pg" {
  export class Pool {
    constructor(config?: { connectionString?: string } & Record<string, any>);
    query(sql: string, params?: any[]): Promise<{ rows: any[]; rowCount: number } & Record<string, any>>;
    end(): Promise<void>;
  }
}
