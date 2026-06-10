export async function migrate({ dryRun }: { dryRun?: boolean }) {
  return {
    dryRun,
    plan: [
      {
        id: "0001_core_tables"
      }
    ]
  };
}

export default function createAuthShouldNotRun() {
  throw new Error("auth should not be constructed during migrate when the hook does not access it");
}
