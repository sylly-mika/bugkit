import { createBugReportRoute } from "@sylly-mika/bugkit/server";

const intakeUrl = process.env.BUGKIT_INTAKE_URL ?? "";
const intakeKey = process.env.BUGKIT_INTAKE_KEY ?? "";

const handler = createBugReportRoute({
  intakeUrl,
  intakeKey,
  reporter: () => ({ name: "Example user", email: "example@example.com" }),
});

export async function POST(request: Request): Promise<Response> {
  if (!intakeUrl || !intakeKey) {
    const form = await request.clone().formData().catch(() => null);
    console.log("bugkit report (no intake configured):", form?.get("summary") ?? "(no summary)");
  }
  return handler(request);
}
